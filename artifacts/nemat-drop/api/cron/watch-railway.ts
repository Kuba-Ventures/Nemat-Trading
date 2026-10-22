// Outside watcher for the Railway API, run by Vercel Cron every 10 minutes
// (vercel.json). Every other health check runs inside Railway, so a Railway
// outage could never report itself; this one runs on the storefront's Vercel
// project instead. It asks the API's /api/healthz, reads the newest check the
// API recorded in ai_service_checks, writes its own "api" row there, and emails
// through Resend directly, since it can't rely on Railway to send.
//
// The API is down when it doesn't answer (two runs in a row, so a blip doesn't
// page anyone) or when it answers but has recorded no check for 30 minutes (on
// the first run). Like the API's own checks it emails only on a change: one
// email when the API goes down, one when it answers again, nothing in between,
// and at most one down email per Pacific day if it keeps flipping. Every read
// goes to Supabase uncached, and a failed read stops the run rather than
// counting as "no earlier rows".
//
// Needs on Vercel: CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.
// Reads VITE_API_URL and VITE_SUPABASE_URL, which the project already has.

export type WatcherStatus = "working" | "down" | "unknown";
export type WatcherFailureKind = "unreachable" | "checks_stopped";
export type WatcherAlertKind = "down" | "recovered";

export type RailwayObservation = {
  apiAnswered: boolean;
  apiHttpStatus: number | null;
  apiError: string | null;
  newestRailwayCheckAtIso: string | null;
};

export type WatcherResult = {
  status: WatcherStatus;
  failureKind: WatcherFailureKind | null;
  failureDetail: string | null;
};

export type WatcherRow = { status: WatcherStatus; checkedAt: string; alertSent: WatcherAlertKind | null };

export const CHECKS_STALE_AFTER_MINUTES = 30;
const BUSINESS_TZ = "America/Los_Angeles";
const DEFAULT_ALERT_RECIPIENT = "finley@qsbsrollover.com";
const DEFAULT_FROM = "Tommy Top Decker <orders@tommytopdecker.com>";
const REQUEST_TIMEOUT_MILLISECONDS = 10_000;

// ─── Pure decisions (unit tested in src/lib/railwayWatch.test.ts) ────────────

export function classifyRailwayObservation(observation: RailwayObservation, nowMilliseconds: number): WatcherResult {
  if (!observation.apiAnswered || (observation.apiHttpStatus ?? 0) >= 500) {
    return {
      status: "down",
      failureKind: "unreachable",
      failureDetail: observation.apiError ?? `the API answered ${observation.apiHttpStatus}`,
    };
  }
  if (!observation.newestRailwayCheckAtIso) {
    return { status: "unknown", failureKind: null, failureDetail: "the API has not recorded a check yet" };
  }
  const minutesSinceLastCheck = (nowMilliseconds - Date.parse(observation.newestRailwayCheckAtIso)) / 60_000;
  if (minutesSinceLastCheck > CHECKS_STALE_AFTER_MINUTES) {
    return {
      status: "down",
      failureKind: "checks_stopped",
      failureDetail: `the API answers but its last health check was ${Math.round(minutesSinceLastCheck)} minutes ago`,
    };
  }
  return { status: "working", failureKind: null, failureDetail: null };
}

function pacificDayKey(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

export function startOfPacificDay(instant: Date): Date {
  const key = pacificDayKey(instant);
  for (const offsetHours of [7, 8]) {
    const guess = new Date(`${key}T0${offsetHours}:00:00Z`);
    if (pacificDayKey(guess) === key && pacificDayKey(new Date(guess.getTime() - 1)) !== key) return guess;
  }
  return new Date(`${key}T08:00:00Z`);
}

export function decideWatcherEmail(
  result: WatcherResult,
  earlierRowsNewestFirst: WatcherRow[],
  now: Date,
): WatcherAlertKind | null {
  const lastReported = earlierRowsNewestFirst.find((row) => row.alertSent !== null);
  if (result.status === "working") {
    return lastReported?.alertSent === "down" ? "recovered" : null;
  }
  if (result.status !== "down") return null;
  const indexOfLastWorking = earlierRowsNewestFirst.findIndex((row) => row.status === "working");
  const currentOutageRows = indexOfLastWorking === -1 ? earlierRowsNewestFirst : earlierRowsNewestFirst.slice(0, indexOfLastWorking);
  if (currentOutageRows.some((row) => row.alertSent === "down")) return null;
  const startOfToday = startOfPacificDay(now).getTime();
  const downEmailAlreadySentToday = earlierRowsNewestFirst.some(
    (row) => row.alertSent === "down" && Date.parse(row.checkedAt) >= startOfToday,
  );
  if (downEmailAlreadySentToday) return null;
  return result.failureKind === "checks_stopped" || earlierRowsNewestFirst[0]?.status === "down" ? "down" : null;
}

export function downSince(earlierRowsNewestFirst: WatcherRow[], fallbackIso: string): string {
  let oldestDown = fallbackIso;
  for (const row of earlierRowsNewestFirst) {
    if (row.status === "working") break;
    if (row.status === "down") oldestDown = row.checkedAt;
  }
  return oldestDown;
}

export function lastReportedDownSince(earlierRowsNewestFirst: WatcherRow[], fallbackIso: string): string {
  const reportedIndex = earlierRowsNewestFirst.findIndex((row) => row.alertSent === "down");
  if (reportedIndex === -1) return fallbackIso;
  return downSince(earlierRowsNewestFirst.slice(reportedIndex), earlierRowsNewestFirst[reportedIndex].checkedAt);
}

export function watcherRecipients(raw: string | undefined): string[] {
  return (raw || DEFAULT_ALERT_RECIPIENT)
    .split(",")
    .map((address) => address.trim())
    .filter((address) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) && /qsbsrollover/i.test(address));
}

function pacificTime(instantIso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
    new Date(instantIso),
  );
}

function describeDuration(fromIso: string, toIso: string): string {
  const totalMinutes = Math.max(1, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  if (minutes === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildWatcherEmail(input: {
  alertKind: WatcherAlertKind;
  result: WatcherResult;
  downSinceIso: string;
  nowIso: string;
  healthPageUrl: string;
}): { subject: string; text: string; html: string } {
  const paragraphs =
    input.alertKind === "down"
      ? [
          `Since ${pacificTime(input.downSinceIso)} PT, customers can't check out, order emails stop and labels can't be printed. The storefront still loads, with the fallback product.`,
          input.result.failureKind === "checks_stopped"
            ? "The API answers but hasn't recorded a health check for over 30 minutes, so its checks have stopped. Check the api-server logs in Railway."
            : "Railway isn't answering. Check the api-server service in Railway (deploy logs, crashes, billing).",
          `What the outside check saw: ${input.result.failureDetail ?? "no answer"}`,
          "This came from the outside check on Vercel, because Railway can't report its own outage. You'll get one more email when it answers again, and nothing in between; the Health view always shows the live status.",
        ]
      : [
          `The Railway API server is working again since ${pacificTime(input.nowIso)} PT, after being down for ${describeDuration(input.downSinceIso, input.nowIso)}.`,
          "You only get an email when the API goes down and another when it is fixed; the Health view always shows the live status.",
        ];
  const subject =
    input.alertKind === "down"
      ? `Tommy Top Decker: the Railway API server is down, customers can't check out`
      : "Tommy Top Decker: the Railway API server is working again";
  const accent = input.alertKind === "down" ? "#dc2626" : "#16a34a";
  const html =
    `<div style="font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111827">` +
    `<div style="border-left:4px solid ${accent};padding-left:14px"><h1 style="font-size:18px;margin:0 0 12px">${escapeHtml(subject)}</h1>` +
    paragraphs.map((paragraph) => `<p style="font-size:14px;line-height:1.5;margin:0 0 12px">${escapeHtml(paragraph)}</p>`).join("") +
    `</div><p style="margin:20px 0 0"><a href="${escapeHtml(input.healthPageUrl)}" style="background:#111827;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:600">Open the Health view</a></p></div>`;
  return { subject, text: [...paragraphs, `Health view: ${input.healthPageUrl}`].join("\n\n"), html };
}

// ─── The cron handler ─────────────────────────────────────────────────────────

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function supabaseRestBase(): string | null {
  const raw = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!raw) return null;
  try {
    return `${new URL(raw).origin}/rest/v1`;
  } catch {
    return null;
  }
}

async function supabaseRead<RowType>(base: string, serviceRoleKey: string, pathAndQuery: string): Promise<RowType[]> {
  const response = await fetch(`${base}/${pathAndQuery}`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Cache-Control": "no-cache" },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
  });
  if (!response.ok) throw new Error(`Supabase read ${response.status}: ${await response.text()}`);
  return (await response.json()) as RowType[];
}

async function observeRailway(apiBase: string): Promise<Omit<RailwayObservation, "newestRailwayCheckAtIso"> & { latencyMilliseconds: number }> {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${apiBase.replace(/\/$/, "")}/api/healthz`, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    });
    return { apiAnswered: true, apiHttpStatus: response.status, apiError: null, latencyMilliseconds: Date.now() - startedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : "no answer";
    return { apiAnswered: false, apiHttpStatus: null, apiError: message.slice(0, 200), latencyMilliseconds: Date.now() - startedAt };
  }
}

async function sendThroughResend(email: { subject: string; text: string; html: string }, recipients: string[], idempotencyKey: string): Promise<boolean> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.warn("[railway-watch] RESEND_API_KEY not set, cannot send");
    return false;
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ from: process.env.ORDER_EMAIL_FROM || DEFAULT_FROM, to: recipients, ...email }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) console.error(`[railway-watch] Resend ${response.status}: ${await response.text()}`);
    return response.ok;
  } catch (error) {
    console.error("[railway-watch] send failed:", error);
    return false;
  }
}

export async function GET(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return json({ error: "Unauthorized" }, 401);
  }
  const apiBase = process.env.RAILWAY_WATCH_API_URL || process.env.VITE_API_URL;
  const restBase = supabaseRestBase();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiBase || !restBase || !serviceRoleKey) {
    return json({ error: "Not configured: needs VITE_API_URL, VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const observed = await observeRailway(apiBase);
  let newestRows: { checked_at: string }[];
  let earlierRows: { status: WatcherStatus; checked_at: string; alert_sent: WatcherAlertKind | null }[];
  try {
    [newestRows, earlierRows] = await Promise.all([
      supabaseRead<{ checked_at: string }>(
        restBase,
        serviceRoleKey,
        "ai_service_checks?select=checked_at&service=not.in.(api,sheets_webhook_call)&order=checked_at.desc&limit=1",
      ),
      supabaseRead<{ status: WatcherStatus; checked_at: string; alert_sent: WatcherAlertKind | null }>(
        restBase,
        serviceRoleKey,
        "ai_service_checks?select=status,checked_at,alert_sent&service=eq.api&order=checked_at.desc&limit=300",
      ),
    ]);
  } catch (error) {
    console.error("[railway-watch] reading Supabase failed, no email and no row this run:", error);
    return json({ error: "Supabase read failed" }, 500);
  }

  const result = classifyRailwayObservation({ ...observed, newestRailwayCheckAtIso: newestRows[0]?.checked_at ?? null }, now.getTime());
  const earlierNewestFirst: WatcherRow[] = earlierRows.map((row) => ({
    status: row.status,
    checkedAt: new Date(row.checked_at).toISOString(),
    alertSent: row.alert_sent,
  }));
  const alertKind = decideWatcherEmail(result, earlierNewestFirst, now);

  let alertSent: WatcherAlertKind | null = null;
  const recipients = watcherRecipients(process.env.AI_HEALTH_ALERT_TO);
  if (alertKind && recipients.length) {
    const site = (process.env.FRONTEND_URL || "https://tommytopdecker.com").split(",")[0].trim().replace(/\/$/, "");
    const email = buildWatcherEmail({
      alertKind,
      result,
      downSinceIso: alertKind === "down" ? downSince(earlierNewestFirst, nowIso) : lastReportedDownSince(earlierNewestFirst, nowIso),
      nowIso,
      healthPageUrl: `${site}/admin?view=health`,
    });
    const sent = await sendThroughResend(email, recipients, `railway-watch-${alertKind}-${nowIso}`);
    alertSent = sent ? alertKind : null;
  }

  const insert = await fetch(`${restBase}/ai_service_checks`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      service: "api",
      checked_at: nowIso,
      status: result.status,
      failure_kind: result.failureKind,
      failure_detail: result.failureDetail,
      latency_ms: observed.latencyMilliseconds,
      alert_sent: alertSent,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
  });
  if (!insert.ok) console.error(`[railway-watch] recording the check failed: ${insert.status} ${await insert.text()}`);

  console.log(`[railway-watch] api=${result.status}${result.failureKind ? ` (${result.failureKind})` : ""}, email ${alertSent ?? "none"}`);
  return json({ status: result.status, failureKind: result.failureKind, alertSent });
}
