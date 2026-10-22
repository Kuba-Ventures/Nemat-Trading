// Runs the dependency health checks every 10 minutes inside the API process, the
// same way the scorecard and Meta ads check schedulers run. Each run stores one
// row per dependency in ai_service_checks and sends at most one health email per
// Pacific day (see dependencyAlerts.ts). Recipients come from AI_HEALTH_ALERT_TO
// (comma separated, team addresses only), defaulting to Finley.
//
// Every read the email decision depends on goes straight to Postgres through
// the pool, never through a cache, and a failed read stops the run instead of
// being treated as "no earlier checks" (an empty read is how Telly sent twice).

import { pool } from "@workspace/db";
import { dayKey, startOfBusinessDay } from "./metrics";
import {
  anAlertEmailWentOutSince,
  buildHealthDailyEmail,
  downSinceForIncident,
  healthAlertRecipients,
  healthPageUrl,
  isOutageWorthReporting,
  isRecoveryAwaitingReport,
  isRunningLowWorthReporting,
  reportedIncidentTimes,
  type DependencyAlertKind,
  type DependencyOutageForEmail,
  type DependencyRecoveryForEmail,
  type DependencyRunningLowForEmail,
  type HealthDailyEmailInput,
} from "./dependencyAlerts";
import {
  SHEETS_WEBHOOK_CALL,
  allDependencyKeys,
  checkClaude,
  checkCloudinary,
  checkDatabase,
  checkRemoveBg,
  checkResend,
  checkSheets,
  checkShippo,
  checkStorefront,
  checkStripe,
  type DependencyCheckResult,
  type DependencyFailureKind,
  type DependencyKey,
  type DependencyStatus,
  type SheetsWebhookCall,
} from "./dependencyChecks";
import { withRunningLowForecast } from "./dependencyLimits";
import type { StoredDependencyCheckWithDetails } from "./dependencySummary";

const CHECK_EVERY_MS = 10 * 60 * 1000;
const DEFAULT_FROM = "Tommy Top Decker <orders@tommytopdecker.com>";
const EARLIER_CHECKS_TO_READ_PER_SERVICE = 300;

type CheckRow = {
  service: DependencyKey;
  status: DependencyStatus;
  failure_kind: DependencyFailureKind | null;
  failure_detail: string | null;
  checked_at: Date | string;
  alert_sent: DependencyAlertKind | null;
  latency_ms: number | null;
  limit_remaining: string | number | null;
  limit_unit: string | null;
  note: string | null;
};

const CHECK_COLUMNS =
  "service, status, failure_kind, failure_detail, checked_at, alert_sent, latency_ms, limit_remaining, limit_unit, note";

export function storedCheckFromRow(checkRow: CheckRow): StoredDependencyCheckWithDetails {
  return {
    service: checkRow.service,
    status: checkRow.status,
    failureKind: checkRow.failure_kind,
    failureDetail: checkRow.failure_detail,
    checkedAt: new Date(checkRow.checked_at).toISOString(),
    alertSent: checkRow.alert_sent,
    latencyMilliseconds: checkRow.latency_ms,
    limitRemaining: checkRow.limit_remaining === null ? null : Number(checkRow.limit_remaining),
    limitUnit: checkRow.limit_unit,
    note: checkRow.note,
  };
}

async function readEarlierChecksNewestFirst(service: DependencyKey): Promise<StoredDependencyCheckWithDetails[]> {
  const { rows } = await pool.query<CheckRow>(
    `SELECT ${CHECK_COLUMNS} FROM ai_service_checks WHERE service = $1 ORDER BY checked_at DESC LIMIT $2`,
    [service, EARLIER_CHECKS_TO_READ_PER_SERVICE],
  );
  return rows.map(storedCheckFromRow);
}

// The outside watcher's "api" rows have their own daily budget, so a Railway
// outage is never silenced by an email the API itself sent earlier that day.
async function readReportedChecksSince(sinceIso: string): Promise<{ checkedAt: string; alertSent: DependencyAlertKind | null }[]> {
  const { rows } = await pool.query<{ checked_at: Date; alert_sent: DependencyAlertKind | null }>(
    "SELECT checked_at, alert_sent FROM ai_service_checks WHERE alert_sent IS NOT NULL AND service <> 'api' AND checked_at >= $1",
    [sinceIso],
  );
  return rows.map((row) => ({ checkedAt: new Date(row.checked_at).toISOString(), alertSent: row.alert_sent }));
}

async function readLastSheetsWebhookCall(): Promise<SheetsWebhookCall | null> {
  const { rows } = await pool.query<{ checked_at: Date; status: string; failure_detail: string | null }>(
    "SELECT checked_at, status, failure_detail FROM ai_service_checks WHERE service = $1 ORDER BY checked_at DESC LIMIT 1",
    [SHEETS_WEBHOOK_CALL],
  );
  const lastRow = rows[0];
  if (!lastRow) return null;
  return { calledAt: new Date(lastRow.checked_at).toISOString(), ok: lastRow.status === "working", error: lastRow.failure_detail };
}

/** Records one real call to the Sheets webhook. Never throws. */
export async function recordSheetsWebhookCall(ok: boolean, error: string | null): Promise<void> {
  try {
    await pool.query(
      "INSERT INTO ai_service_checks (service, status, failure_detail) VALUES ($1, $2, $3)",
      [SHEETS_WEBHOOK_CALL, ok ? "working" : "down", ok ? null : (error ?? "failed").slice(0, 300)],
    );
  } catch (err) {
    console.error("[dependency-health] recording the Sheets webhook call failed:", err);
  }
}

/** Sends through Resend. Returns false (never throws) when the send failed. */
async function sendHealthDailyEmail(emailInput: HealthDailyEmailInput, recipients: string[], idempotencyKey: string): Promise<boolean> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.warn("[dependency-health] RESEND_API_KEY not set, cannot send the health email");
    return false;
  }
  const healthEmail = buildHealthDailyEmail(emailInput);
  try {
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from: process.env.ORDER_EMAIL_FROM || DEFAULT_FROM,
        to: recipients,
        subject: healthEmail.subject,
        html: healthEmail.html,
        text: healthEmail.text,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!resendResponse.ok) {
      console.error(`[dependency-health] Resend ${resendResponse.status}: ${await resendResponse.text()}`);
      return false;
    }
    console.log(`[dependency-health] sent "${healthEmail.subject}" to ${recipients.join(", ")}`);
    return true;
  } catch (err) {
    console.error("[dependency-health] health email send failed:", err);
    return false;
  }
}

export type HealthRunOutcome = {
  checks: { service: DependencyKey; status: DependencyStatus; alertSent: DependencyAlertKind | null }[];
  email: "sent" | "not_needed" | "already_sent_today" | "no_recipients" | "send_failed";
};

async function runAllChecks(now: Date): Promise<DependencyCheckResult[]> {
  const lastSheetsCall = await readLastSheetsWebhookCall();
  return Promise.all([
    checkStorefront(),
    checkStripe(),
    checkDatabase(() => pool.query("SELECT 1")),
    checkShippo(),
    checkResend(),
    Promise.resolve(checkSheets(lastSheetsCall, !!process.env.SHEETS_WEBHOOK_URL, now.getTime())),
    checkClaude(),
    checkRemoveBg(),
    checkCloudinary(),
  ]);
}

export async function runDependencyHealthCheck(now = new Date()): Promise<HealthRunOutcome> {
  const nowIso = now.toISOString();
  const recipients = healthAlertRecipients();
  const rawResults = await runAllChecks(now);
  const earlierChecksByService = await Promise.all(rawResults.map((result) => readEarlierChecksNewestFirst(result.service)));
  const checkResults = rawResults.map((result, index) =>
    withRunningLowForecast(
      result,
      earlierChecksByService[index]
        .filter((check) => check.limitRemaining !== null)
        .map((check) => ({ checkedAt: check.checkedAt, remaining: check.limitRemaining! })),
      now.getTime(),
    ),
  );

  const outages: DependencyOutageForEmail[] = [];
  const runningLow: DependencyRunningLowForEmail[] = [];
  const recoveries: DependencyRecoveryForEmail[] = [];
  const alertKindByService = new Map<DependencyKey, DependencyAlertKind>();
  checkResults.forEach((checkResult, index) => {
    const earlierChecksNewestFirst = earlierChecksByService[index];
    if (isOutageWorthReporting(checkResult, earlierChecksNewestFirst)) {
      outages.push({
        service: checkResult.service,
        failureKind: checkResult.failureKind,
        failureDetail: checkResult.failureDetail,
        downSinceIso: downSinceForIncident(earlierChecksNewestFirst, nowIso),
      });
      alertKindByService.set(checkResult.service, "down");
    } else if (isRunningLowWorthReporting(checkResult)) {
      runningLow.push({ service: checkResult.service, failureDetail: checkResult.failureDetail });
      alertKindByService.set(checkResult.service, "running_low");
    } else if (isRecoveryAwaitingReport(checkResult, earlierChecksNewestFirst)) {
      recoveries.push({ service: checkResult.service, ...reportedIncidentTimes(earlierChecksNewestFirst, nowIso) });
      alertKindByService.set(checkResult.service, "recovered");
    }
  });

  let email: HealthRunOutcome["email"] = "not_needed";
  if (outages.length || runningLow.length || recoveries.length) {
    const emailAlreadySentToday = anAlertEmailWentOutSince(
      await readReportedChecksSince(startOfBusinessDay(now).toISOString()),
      startOfBusinessDay(now).toISOString(),
    );
    if (emailAlreadySentToday) {
      email = "already_sent_today";
    } else if (!recipients.length) {
      email = "no_recipients";
    } else {
      const sent = await sendHealthDailyEmail(
        { outages, runningLow, recoveries, healthPageUrl: healthPageUrl() },
        recipients,
        `dependency-health-${dayKey(now)}`,
      );
      email = sent ? "sent" : "send_failed";
    }
  }

  const rowValues: unknown[] = [];
  const rowPlaceholders = checkResults.map((checkResult, index) => {
    const alertSent = email === "sent" ? alertKindByService.get(checkResult.service) ?? null : null;
    rowValues.push(
      checkResult.service,
      nowIso,
      checkResult.status,
      checkResult.failureKind,
      checkResult.failureDetail,
      checkResult.latencyMilliseconds,
      alertSent,
      checkResult.limitRemaining,
      checkResult.limitUnit,
      checkResult.note,
    );
    const base = index * 10;
    return `(${Array.from({ length: 10 }, (_, offset) => `$${base + offset + 1}`).join(", ")})`;
  });
  await pool.query(
    `INSERT INTO ai_service_checks (service, checked_at, status, failure_kind, failure_detail, latency_ms, alert_sent, limit_remaining, limit_unit, note)
     VALUES ${rowPlaceholders.join(", ")}`,
    rowValues,
  );

  return {
    checks: checkResults.map((checkResult) => ({
      service: checkResult.service,
      status: checkResult.status,
      alertSent: email === "sent" ? alertKindByService.get(checkResult.service) ?? null : null,
    })),
    email,
  };
}

export async function readRecentChecksForAllServices(
  sinceIso: string,
): Promise<Record<DependencyKey, StoredDependencyCheckWithDetails[]>> {
  const { rows } = await pool.query<CheckRow>(
    `SELECT ${CHECK_COLUMNS} FROM ai_service_checks WHERE checked_at >= $1 AND service <> $2 ORDER BY checked_at DESC LIMIT 20000`,
    [sinceIso, SHEETS_WEBHOOK_CALL],
  );
  const checksByService = Object.fromEntries(
    allDependencyKeys.map((service) => [service, [] as StoredDependencyCheckWithDetails[]]),
  ) as Record<DependencyKey, StoredDependencyCheckWithDetails[]>;
  for (const checkRow of rows) {
    checksByService[checkRow.service]?.push(storedCheckFromRow(checkRow));
  }
  return checksByService;
}

let timer: NodeJS.Timeout | null = null;

export function startDependencyHealthScheduler(): void {
  if (timer) return;
  if (process.env.NODE_ENV === "development") {
    console.log("[dependency-health] off in development, so local runs never spend credit or send alerts");
    return;
  }
  const recipients = healthAlertRecipients();
  console.log(
    `[dependency-health] on, checking every 10 minutes, at most one email a day to ${recipients.join(", ") || "nobody (AI_HEALTH_ALERT_TO has no team address)"}`,
  );
  const tick = () =>
    runDependencyHealthCheck()
      .then((outcome) =>
        console.log(
          `[dependency-health] ${outcome.checks.map((check) => `${check.service}=${check.status}`).join(", ")}; email ${outcome.email}`,
        ),
      )
      .catch((err) => console.error("[dependency-health] tick failed:", err));
  setTimeout(tick, 60_000);
  timer = setInterval(tick, CHECK_EVERY_MS);
  timer.unref();
}
