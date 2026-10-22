// Runs the AI health checks every 10 minutes inside the API process, the same
// way the scorecard and Meta ads check schedulers run. Each run stores one row
// per service in ai_service_checks and emails the team when a service goes down
// and again when it recovers. Recipients come from AI_HEALTH_ALERT_TO (comma
// separated, team addresses only), defaulting to Finley.

import { pool } from "@workspace/db";
import {
  aiHealthAlertRecipients,
  aiHealthPageUrl,
  buildAiServiceAlertEmail,
  decideAiServiceAlert,
  downSinceForIncident,
  type AiServiceAlertKind,
  type StoredAiServiceCheck,
} from "./aiHealthAlerts";
import {
  allAiServiceNames,
  checkAllAiServices,
  type AiServiceCheckResult,
  type AiServiceFailureKind,
  type AiServiceName,
  type AiServiceStatus,
} from "./aiHealthChecks";
import type { StoredAiServiceCheckWithLatency } from "./aiHealthSummary";

const CHECK_EVERY_MS = 10 * 60 * 1000;
const DEFAULT_FROM = "Tommy Top Decker <orders@tommytopdecker.com>";
const EARLIER_CHECKS_TO_READ_PER_SERVICE = 300;

type AiServiceCheckRow = {
  service: AiServiceName;
  status: AiServiceStatus;
  failure_kind: AiServiceFailureKind | null;
  failure_detail: string | null;
  checked_at: Date | string;
  alert_sent: AiServiceAlertKind | null;
  latency_ms: number | null;
};

const CHECK_COLUMNS = "service, status, failure_kind, failure_detail, checked_at, alert_sent, latency_ms";

export function storedCheckFromRow(checkRow: AiServiceCheckRow): StoredAiServiceCheckWithLatency {
  return {
    service: checkRow.service,
    status: checkRow.status,
    failureKind: checkRow.failure_kind,
    failureDetail: checkRow.failure_detail,
    checkedAt: new Date(checkRow.checked_at).toISOString(),
    alertSent: checkRow.alert_sent,
    latencyMilliseconds: checkRow.latency_ms,
  };
}

async function readEarlierChecksNewestFirst(service: AiServiceName): Promise<StoredAiServiceCheck[]> {
  const { rows } = await pool.query<AiServiceCheckRow>(
    `SELECT ${CHECK_COLUMNS} FROM ai_service_checks WHERE service = $1 ORDER BY checked_at DESC LIMIT $2`,
    [service, EARLIER_CHECKS_TO_READ_PER_SERVICE],
  );
  return rows.map(storedCheckFromRow);
}

/** Sends through Resend. Returns false (never throws) when the send failed. */
async function sendAiServiceAlert(
  alertKind: AiServiceAlertKind,
  checkResult: AiServiceCheckResult,
  downSinceIso: string,
  nowIso: string,
  recipients: string[],
): Promise<boolean> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.warn("[ai-health] RESEND_API_KEY not set, cannot send the alert");
    return false;
  }
  const alertEmail = buildAiServiceAlertEmail({
    alertKind,
    service: checkResult.service,
    failureKind: checkResult.failureKind,
    failureDetail: checkResult.failureDetail,
    downSinceIso,
    nowIso,
    healthPageUrl: aiHealthPageUrl(),
  });
  try {
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `ai-health-${checkResult.service}-${alertKind}-${downSinceIso}`,
      },
      body: JSON.stringify({
        from: process.env.ORDER_EMAIL_FROM || DEFAULT_FROM,
        to: recipients,
        subject: alertEmail.subject,
        html: alertEmail.html,
        text: alertEmail.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resendResponse.ok) {
      console.error(`[ai-health] Resend ${resendResponse.status}: ${await resendResponse.text()}`);
      return false;
    }
    console.log(`[ai-health] sent ${alertKind} alert for ${checkResult.service} to ${recipients.join(", ")}`);
    return true;
  } catch (err) {
    console.error("[ai-health] alert send failed:", err);
    return false;
  }
}

export type AiServiceCheckOutcome = {
  service: AiServiceName;
  status: AiServiceStatus;
  failureKind: AiServiceFailureKind | null;
  alertSent: AiServiceAlertKind | null;
};

async function recordCheckAndAlertIfNeeded(
  checkResult: AiServiceCheckResult,
  recipients: string[],
  now: Date,
): Promise<AiServiceCheckOutcome> {
  const nowIso = now.toISOString();
  const earlierChecksNewestFirst = await readEarlierChecksNewestFirst(checkResult.service);
  const alertKindToSend = decideAiServiceAlert(checkResult, earlierChecksNewestFirst);
  const downSinceIso = downSinceForIncident(earlierChecksNewestFirst, nowIso);

  const alertWasSent =
    alertKindToSend !== null &&
    recipients.length > 0 &&
    (await sendAiServiceAlert(alertKindToSend, checkResult, downSinceIso, nowIso, recipients));
  const alertSent = alertWasSent ? alertKindToSend : null;

  await pool.query(
    `INSERT INTO ai_service_checks (service, checked_at, status, failure_kind, failure_detail, latency_ms, alert_sent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      checkResult.service,
      nowIso,
      checkResult.status,
      checkResult.failureKind,
      checkResult.failureDetail,
      checkResult.latencyMilliseconds,
      alertSent,
    ],
  );

  return { service: checkResult.service, status: checkResult.status, failureKind: checkResult.failureKind, alertSent };
}

export async function runAiHealthCheck(now = new Date()): Promise<AiServiceCheckOutcome[]> {
  const recipients = aiHealthAlertRecipients();
  const checkResults = await checkAllAiServices();
  return Promise.all(checkResults.map((checkResult) => recordCheckAndAlertIfNeeded(checkResult, recipients, now)));
}

export async function readRecentChecksForAllServices(
  sinceIso: string,
): Promise<Record<AiServiceName, StoredAiServiceCheckWithLatency[]>> {
  const { rows } = await pool.query<AiServiceCheckRow>(
    `SELECT ${CHECK_COLUMNS} FROM ai_service_checks WHERE checked_at >= $1 ORDER BY checked_at DESC LIMIT 5000`,
    [sinceIso],
  );
  const checksByService = Object.fromEntries(
    allAiServiceNames.map((service) => [service, [] as StoredAiServiceCheckWithLatency[]]),
  ) as Record<AiServiceName, StoredAiServiceCheckWithLatency[]>;
  for (const checkRow of rows) {
    checksByService[checkRow.service]?.push(storedCheckFromRow(checkRow));
  }
  return checksByService;
}

let timer: NodeJS.Timeout | null = null;

export function startAiHealthScheduler(): void {
  if (timer) return;
  if (process.env.NODE_ENV === "development") {
    console.log("[ai-health] off in development, so local runs never spend credit or send alerts");
    return;
  }
  const recipients = aiHealthAlertRecipients();
  console.log(
    `[ai-health] on, checking ${allAiServiceNames.join(", ")} every 10 minutes, alerts to ${recipients.join(", ") || "nobody (AI_HEALTH_ALERT_TO has no team address)"}`,
  );
  const tick = () =>
    runAiHealthCheck()
      .then((outcomes) =>
        console.log(
          `[ai-health] ${outcomes.map((o) => `${o.service}=${o.status}${o.alertSent ? ` (${o.alertSent} alert sent)` : ""}`).join(", ")}`,
        ),
      )
      .catch((err) => console.error("[ai-health] tick failed:", err));
  setTimeout(tick, 60_000);
  timer = setInterval(tick, CHECK_EVERY_MS);
  timer.unref();
}
