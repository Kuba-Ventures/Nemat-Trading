// Pure alert logic for the dependency health checks: when to email and what the
// email says. No I/O here, so it is all unit tested.
//
// Email only when something goes down and when it is fixed (copied from Telly,
// voice-agent PR #190). No reminders while an outage lasts, never an "all good"
// email, and no "running low" email: running low shows on the Health page only,
// and a limit that actually runs out is a down. Services that change in the same
// run share one email. A service that keeps flipping gets at most one down email
// per Pacific day. Failures that never fix themselves (out of credit, a rejected
// key) count from the first failed check; transient ones (outage, rate limit,
// network) need a second failed check in a row, so a blip doesn't page anyone.

import { BUSINESS_TZ, isInternalEmail } from "./metrics";
import { esc } from "./weeklySnapshot";
import type { DependencyCheckResult, DependencyFailureKind, DependencyKey, DependencyStatus } from "./dependencyChecks";

export type DependencyAlertKind = "down" | "recovered";

export type StoredDependencyCheck = {
  service: DependencyKey;
  status: DependencyStatus;
  failureKind: DependencyFailureKind | null;
  failureDetail: string | null;
  checkedAt: string;
  alertSent: DependencyAlertKind | null;
};

const DEFAULT_ALERT_RECIPIENT = "finley@qsbsrollover.com";

export function healthAlertRecipients(raw = process.env.AI_HEALTH_ALERT_TO || DEFAULT_ALERT_RECIPIENT): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && isInternalEmail(s));
}

export function healthPageUrl(frontendUrl = process.env.FRONTEND_URL ?? "https://tommytopdecker.com"): string {
  const site = frontendUrl.split(",")[0].trim().replace(/\/$/, "");
  return `${site}/admin?view=health`;
}

const failureKindsThatNeverFixThemselves: DependencyFailureKind[] = [
  "out_of_credits",
  "out_of_quota",
  "key_rejected",
  "key_not_allowed",
  "domain_not_verified",
  "checks_stopped",
];

export const dependencyDisplayNames: Record<DependencyKey, string> = {
  api: "Railway API server",
  site: "Vercel storefront",
  stripe: "Stripe",
  db: "Supabase database",
  shippo: "Shippo",
  resend: "Resend",
  sheets: "Google Sheets log",
  claude: "Claude",
  removebg: "remove.bg",
  cloudinary: "Cloudinary",
};

export const whatBreaksForUsers: Record<DependencyKey, string> = {
  api: "customers can't check out, order emails stop and labels can't be printed",
  site: "the shop doesn't load for customers",
  stripe: "customers can't pay at checkout and new orders aren't recorded",
  db: "checkout, orders, products and stock all fail",
  shippo: "shipping rates at checkout fail, so customers can't check out, and labels can't be bought",
  resend: "order confirmations, sales alerts and label emails stop sending (this email may not arrive either)",
  sheets: "new orders and signups stop reaching the Google Sheet order log",
  claude:
    "product lookups in the admin fall back to the plain boilerplate intel report instead of the Tommy Top Decker voice, and the Style It button fails. The live storefront keeps showing what was already saved",
  removebg: "the Remove background button on product images in the admin fails. The live storefront is not affected",
  cloudinary: "product image uploads in the admin fail. Images already on the storefront keep working",
};

const railwayVariables = "the Railway api-server variables";

const whatToDo: Record<DependencyFailureKind, (service: DependencyKey) => string> = {
  out_of_credits: (service) =>
    service === "claude"
      ? "Someone with billing access on the Anthropic organization that owns the shop's ANTHROPIC_API_KEY needs to add credits in Console > Billing and turn on auto-reload."
      : service === "removebg"
        ? "Someone with access to the remove.bg account needs to buy credits or upgrade the plan at remove.bg/dashboard."
        : `Add credit to the ${dependencyDisplayNames[service]} account.`,
  out_of_quota: (service) =>
    `The ${dependencyDisplayNames[service]} plan has used everything it includes for this period. Upgrade the plan or wait for it to reset.`,
  running_low: (service) =>
    service === "removebg"
      ? "Buy remove.bg credits at remove.bg/dashboard before they run out."
      : `Top up or upgrade ${dependencyDisplayNames[service]} before it runs out.`,
  key_rejected: (service) =>
    `The ${dependencyDisplayNames[service]} key or setting was rejected. It was probably revoked or rotated, so check it in ${railwayVariables}.`,
  key_not_allowed: (service) =>
    `The ${dependencyDisplayNames[service]} key is valid but not allowed to do this. Check its permissions and settings.`,
  domain_not_verified: () =>
    "The sending domain is not verified in Resend. Check its DNS records in Resend > Domains. Nobody gets order emails until it is.",
  rate_limited: (service) =>
    `${dependencyDisplayNames[service]} is rate limiting the key. Check the rate limits on the account the key belongs to.`,
  provider_outage: (service) =>
    `${dependencyDisplayNames[service]} is having problems on their side. Check their status page. Nothing to change unless it lasts.`,
  unreachable: (service) =>
    service === "api"
      ? "Railway isn't answering. Check the api-server service in Railway (deploy logs, crashes, billing)."
      : `${dependencyDisplayNames[service]} could not be reached from Railway at all. Usually a network blip; check their status page if it lasts.`,
  checks_stopped: () =>
    "The API answers but hasn't recorded a health check for over 30 minutes, so its checks have stopped. Check the api-server logs in Railway.",
  unexpected_response: (service) =>
    `${dependencyDisplayNames[service]} answered with something unexpected. The detail below says what.`,
  not_configured: (service) => `The ${dependencyDisplayNames[service]} key is missing from ${railwayVariables}.`,
  cannot_check: (service) => `The ${dependencyDisplayNames[service]} key cannot be checked with the permissions it has.`,
  no_recent_activity: () => "Nothing has used it recently, so there is nothing to check yet.",
};

export const dependencyFailureSummaries: Record<DependencyFailureKind, string> = {
  out_of_credits: "the credit balance is too low",
  out_of_quota: "the plan is used up",
  running_low: "it is running low",
  key_rejected: "the key was rejected",
  key_not_allowed: "the key is not allowed",
  domain_not_verified: "the sending domain is not verified",
  rate_limited: "requests are being rate limited",
  provider_outage: "the service is having an outage",
  unreachable: "it cannot be reached",
  checks_stopped: "its checks have stopped",
  unexpected_response: "it returned an unexpected error",
  not_configured: "it is not configured",
  cannot_check: "it cannot be checked",
  no_recent_activity: "nothing has used it recently",
};

// Running low still works, so it ends an outage just like working does.
const isUp = (status: DependencyStatus) => status === "working" || status === "warning";

function checksInTheCurrentIncident(earlierChecksNewestFirst: StoredDependencyCheck[]): StoredDependencyCheck[] {
  const indexOfMostRecentWorkingCheck = earlierChecksNewestFirst.findIndex((check) => isUp(check.status));
  return indexOfMostRecentWorkingCheck === -1
    ? earlierChecksNewestFirst
    : earlierChecksNewestFirst.slice(0, indexOfMostRecentWorkingCheck);
}

export function isOutageWorthReporting(
  newCheck: Pick<DependencyCheckResult, "status" | "failureKind">,
  earlierChecksNewestFirst: StoredDependencyCheck[],
): boolean {
  if (newCheck.status !== "down") return false;
  const outageWasAlreadyReported = checksInTheCurrentIncident(earlierChecksNewestFirst).some(
    (check) => check.alertSent === "down",
  );
  if (outageWasAlreadyReported) return false;
  const failureNeverFixesItself =
    newCheck.failureKind !== null && failureKindsThatNeverFixThemselves.includes(newCheck.failureKind);
  const previousCheckWasAlsoDown = earlierChecksNewestFirst[0]?.status === "down";
  return failureNeverFixesItself || previousCheckWasAlsoDown;
}

function indexOfMostRecentlyReportedCheck(earlierChecksNewestFirst: StoredDependencyCheck[]): number {
  return earlierChecksNewestFirst.findIndex((check) => check.alertSent !== null);
}

export function isRecoveryAwaitingReport(
  newCheck: Pick<DependencyCheckResult, "status">,
  earlierChecksNewestFirst: StoredDependencyCheck[],
): boolean {
  if (!isUp(newCheck.status)) return false;
  const reportedCheckIndex = indexOfMostRecentlyReportedCheck(earlierChecksNewestFirst);
  return reportedCheckIndex !== -1 && earlierChecksNewestFirst[reportedCheckIndex].alertSent === "down";
}

export function downSinceForIncident(earlierChecksNewestFirst: StoredDependencyCheck[], fallbackInstantIso: string): string {
  const currentIncidentDownChecks = checksInTheCurrentIncident(earlierChecksNewestFirst).filter(
    (check) => check.status === "down",
  );
  return currentIncidentDownChecks.at(-1)?.checkedAt ?? fallbackInstantIso;
}

export function reportedIncidentTimes(
  earlierChecksNewestFirst: StoredDependencyCheck[],
  fallbackInstantIso: string,
): { downSinceIso: string; recoveredAtIso: string } {
  const reportedCheckIndex = indexOfMostRecentlyReportedCheck(earlierChecksNewestFirst);
  if (reportedCheckIndex === -1) return { downSinceIso: fallbackInstantIso, recoveredAtIso: fallbackInstantIso };

  let oldestDownIndex = reportedCheckIndex;
  while (earlierChecksNewestFirst[oldestDownIndex + 1]?.status === "down") oldestDownIndex += 1;

  let firstWorkingAfterIndex = -1;
  for (let checkIndex = reportedCheckIndex - 1; checkIndex >= 0; checkIndex -= 1) {
    if (isUp(earlierChecksNewestFirst[checkIndex].status)) {
      firstWorkingAfterIndex = checkIndex;
      break;
    }
  }

  return {
    downSinceIso: earlierChecksNewestFirst[oldestDownIndex].checkedAt,
    recoveredAtIso:
      firstWorkingAfterIndex === -1 ? fallbackInstantIso : earlierChecksNewestFirst[firstWorkingAfterIndex].checkedAt,
  };
}

export function aDownEmailWentOutForThisServiceSince(
  earlierChecksNewestFirst: Pick<StoredDependencyCheck, "checkedAt" | "alertSent">[],
  sinceInstantIso: string,
): boolean {
  const sinceMilliseconds = Date.parse(sinceInstantIso);
  return earlierChecksNewestFirst.some((check) => check.alertSent === "down" && Date.parse(check.checkedAt) >= sinceMilliseconds);
}

export function formatPacificTime(instantIso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(instantIso));
}

export function describeDowntime(downSinceIso: string, recoveredAtIso: string): string {
  const totalMinutes = Math.max(1, Math.round((Date.parse(recoveredAtIso) - Date.parse(downSinceIso)) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  if (minutes === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export type DependencyOutageForEmail = {
  service: DependencyKey;
  failureKind: DependencyFailureKind | null;
  failureDetail: string | null;
  downSinceIso: string;
};

export type DependencyRecoveryForEmail = { service: DependencyKey; downSinceIso: string; recoveredAtIso: string };

export type HealthAlertEmailInput = {
  outages: DependencyOutageForEmail[];
  recoveries: DependencyRecoveryForEmail[];
  healthPageUrl: string;
};

export type HealthEmail = { subject: string; text: string; html: string };

const brand = "Tommy Top Decker";

export function alertEmailSubject(emailInput: Pick<HealthAlertEmailInput, "outages" | "recoveries">): string {
  if (emailInput.outages.length === 1) {
    const outage = emailInput.outages[0];
    return `${brand}: ${dependencyDisplayNames[outage.service]} is down, ${dependencyFailureSummaries[outage.failureKind ?? "unexpected_response"]}`;
  }
  if (emailInput.outages.length > 1) return `${brand}: ${emailInput.outages.length} services are down`;
  if (emailInput.recoveries.length === 1) {
    return `${brand}: ${dependencyDisplayNames[emailInput.recoveries[0].service]} is working again`;
  }
  return `${brand}: ${emailInput.recoveries.length} services are working again`;
}

function outageParagraphs(outage: DependencyOutageForEmail): string[] {
  const serviceName = dependencyDisplayNames[outage.service];
  const failureKind = outage.failureKind ?? "unexpected_response";
  const paragraphs = [
    `${serviceName} is down: since ${formatPacificTime(outage.downSinceIso)} PT, ${whatBreaksForUsers[outage.service]}.`,
    whatToDo[failureKind](outage.service),
  ];
  if (outage.failureDetail) paragraphs.push(`What ${serviceName} said: ${outage.failureDetail}`);
  return paragraphs;
}

function recoveryParagraph(recovery: DependencyRecoveryForEmail): string {
  return `${dependencyDisplayNames[recovery.service]} is working again since ${formatPacificTime(recovery.recoveredAtIso)} PT, after being down for ${describeDowntime(recovery.downSinceIso, recovery.recoveredAtIso)}.`;
}

export const alertEmailRuleNotice =
  "You only get an email when something goes down and another when it is fixed. Nothing is sent while it stays down or while everything is working; the Health view always shows the live status, including anything running low.";

export function buildHealthAlertEmail(emailInput: HealthAlertEmailInput): HealthEmail {
  const subject = alertEmailSubject(emailInput);
  const paragraphs = [
    ...emailInput.outages.flatMap(outageParagraphs),
    ...emailInput.recoveries.map(recoveryParagraph),
    alertEmailRuleNotice,
  ];
  const text = [...paragraphs, `Health view: ${emailInput.healthPageUrl}`].join("\n\n");
  const accentColor = emailInput.outages.length > 0 ? "#dc2626" : "#16a34a";
  const html =
    `<div style="font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111827">` +
    `<div style="border-left:4px solid ${accentColor};padding-left:14px">` +
    `<h1 style="font-size:18px;margin:0 0 12px">${esc(subject)}</h1>` +
    paragraphs.map((paragraph) => `<p style="font-size:14px;line-height:1.5;margin:0 0 12px">${esc(paragraph)}</p>`).join("") +
    `</div>` +
    `<p style="margin:20px 0 0"><a href="${esc(emailInput.healthPageUrl)}" style="background:#111827;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:600">Open the Health view</a></p>` +
    `</div>`;
  return { subject, text, html };
}
