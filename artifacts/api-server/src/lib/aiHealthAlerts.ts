// Pure alert logic for the AI health checks: when to email, when an incident
// started, and what the email says. No I/O here, so it is all unit tested.
//
// Failures that never fix themselves (out of credit, a rejected key) alert on the
// first failed check. Transient ones (outage, rate limit, network) wait for a
// second failed check in a row, so a blip doesn't page anyone. Each incident gets
// one down email and one recovered email.

import { BUSINESS_TZ, isInternalEmail } from "./metrics";
import { esc } from "./weeklySnapshot";
import type { AiServiceCheckResult, AiServiceFailureKind, AiServiceName, AiServiceStatus } from "./aiHealthChecks";

export type AiServiceAlertKind = "down" | "recovered";

const DEFAULT_ALERT_RECIPIENT = "finley@qsbsrollover.com";

export function aiHealthAlertRecipients(raw = process.env.AI_HEALTH_ALERT_TO || DEFAULT_ALERT_RECIPIENT): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && isInternalEmail(s));
}

export function aiHealthPageUrl(frontendUrl = process.env.FRONTEND_URL ?? "https://tommytopdecker.com"): string {
  const site = frontendUrl.split(",")[0].trim().replace(/\/$/, "");
  return `${site}/admin?view=health`;
}

export type StoredAiServiceCheck = {
  service: AiServiceName;
  status: AiServiceStatus;
  failureKind: AiServiceFailureKind | null;
  failureDetail: string | null;
  checkedAt: string;
  alertSent: AiServiceAlertKind | null;
};

const failureKindsThatNeverFixThemselves: AiServiceFailureKind[] = [
  "out_of_credits",
  "out_of_quota",
  "key_rejected",
  "key_not_allowed",
];

export const aiServiceDisplayNames: Record<AiServiceName, string> = {
  claude: "Claude",
  removebg: "remove.bg",
};

export const whatBreaksForUsers: Record<AiServiceName, string> = {
  claude:
    "product lookups in the admin fall back to the plain boilerplate intel report instead of the Tommy Top Decker voice, and the Style It button fails. The live storefront keeps showing what was already saved",
  removebg:
    "the Remove background button on product images in the admin fails, so new product photos can't be cut out. The live storefront is not affected",
};

const whatToDo: Record<AiServiceFailureKind, (service: AiServiceName) => string> = {
  out_of_credits: (service) =>
    service === "claude"
      ? "Someone with billing access on the Anthropic organization that owns the shop's ANTHROPIC_API_KEY needs to add credits in Console > Billing and turn on auto-reload."
      : "Someone with access to the remove.bg account needs to buy credits or upgrade the plan at remove.bg/dashboard.",
  out_of_quota: (service) =>
    `The ${aiServiceDisplayNames[service]} plan has used everything it includes for this period. Upgrade the plan or wait for it to reset.`,
  key_rejected: (service) =>
    `The ${aiServiceDisplayNames[service]} API key was rejected. It was probably revoked or rotated, so check the key in the Railway api-server variables.`,
  key_not_allowed: (service) =>
    `The ${aiServiceDisplayNames[service]} API key is valid but not allowed to do this. Check its permissions and workspace.`,
  rate_limited: (service) =>
    `${aiServiceDisplayNames[service]} is rate limiting the key. Check the rate limits on the account the key belongs to.`,
  provider_outage: (service) =>
    `${aiServiceDisplayNames[service]} is having problems on their side. Check their status page. Nothing to change unless it lasts.`,
  unreachable: (service) =>
    `${aiServiceDisplayNames[service]} could not be reached from Railway at all. Usually a network blip; check their status page if it lasts.`,
  unexpected_response: (service) =>
    `${aiServiceDisplayNames[service]} answered with something unexpected. The detail below says what.`,
  not_configured: (service) => `The ${aiServiceDisplayNames[service]} key is missing from the Railway api-server variables.`,
  cannot_check: (service) => `The ${aiServiceDisplayNames[service]} key cannot be checked with the permissions it has.`,
};

export const aiServiceFailureSummaries: Record<AiServiceFailureKind, string> = {
  out_of_credits: "the credit balance is too low",
  out_of_quota: "the plan is used up",
  key_rejected: "the API key was rejected",
  key_not_allowed: "the API key is not allowed",
  rate_limited: "requests are being rate limited",
  provider_outage: "the service is having an outage",
  unreachable: "the service cannot be reached",
  unexpected_response: "it returned an unexpected error",
  not_configured: "the key is not configured",
  cannot_check: "the key cannot be checked",
};

function checksInTheCurrentIncident(earlierChecksNewestFirst: StoredAiServiceCheck[]): StoredAiServiceCheck[] {
  const indexOfMostRecentWorkingCheck = earlierChecksNewestFirst.findIndex((check) => check.status === "working");
  return indexOfMostRecentWorkingCheck === -1
    ? earlierChecksNewestFirst
    : earlierChecksNewestFirst.slice(0, indexOfMostRecentWorkingCheck);
}

export function decideAiServiceAlert(
  newCheck: Pick<AiServiceCheckResult, "status" | "failureKind">,
  earlierChecksNewestFirst: StoredAiServiceCheck[],
): AiServiceAlertKind | null {
  const currentIncidentChecks = checksInTheCurrentIncident(earlierChecksNewestFirst);
  const downAlertAlreadySentForThisIncident = currentIncidentChecks.some((check) => check.alertSent === "down");

  if (newCheck.status === "working") {
    return downAlertAlreadySentForThisIncident ? "recovered" : null;
  }
  if (newCheck.status !== "down" || downAlertAlreadySentForThisIncident) {
    return null;
  }

  const failureNeverFixesItself =
    newCheck.failureKind !== null && failureKindsThatNeverFixThemselves.includes(newCheck.failureKind);
  const previousCheckWasAlsoDown = earlierChecksNewestFirst[0]?.status === "down";
  return failureNeverFixesItself || previousCheckWasAlsoDown ? "down" : null;
}

export function downSinceForIncident(earlierChecksNewestFirst: StoredAiServiceCheck[], fallbackInstantIso: string): string {
  const currentIncidentDownChecks = checksInTheCurrentIncident(earlierChecksNewestFirst).filter(
    (check) => check.status === "down",
  );
  return currentIncidentDownChecks.at(-1)?.checkedAt ?? fallbackInstantIso;
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

export type AiServiceAlertEmailInput = {
  alertKind: AiServiceAlertKind;
  service: AiServiceName;
  failureKind: AiServiceFailureKind | null;
  failureDetail: string | null;
  downSinceIso: string;
  nowIso: string;
  healthPageUrl: string;
};

export type AiServiceAlertEmail = { subject: string; text: string; html: string };

export function buildAiServiceAlertEmail(alertInput: AiServiceAlertEmailInput): AiServiceAlertEmail {
  const serviceName = aiServiceDisplayNames[alertInput.service];
  const paragraphs = alertEmailParagraphs(alertInput, serviceName);
  const subject =
    alertInput.alertKind === "down"
      ? `Tommy Top Decker: ${serviceName} is down, ${aiServiceFailureSummaries[alertInput.failureKind ?? "unexpected_response"]}`
      : `Tommy Top Decker: ${serviceName} is working again`;
  const text = [...paragraphs, `Health view: ${alertInput.healthPageUrl}`].join("\n\n");
  const accentColor = alertInput.alertKind === "down" ? "#dc2626" : "#16a34a";
  const html =
    `<div style="font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111827">` +
    `<div style="border-left:4px solid ${accentColor};padding-left:14px">` +
    `<h1 style="font-size:18px;margin:0 0 12px">${esc(subject)}</h1>` +
    paragraphs.map((paragraph) => `<p style="font-size:14px;line-height:1.5;margin:0 0 12px">${esc(paragraph)}</p>`).join("") +
    `</div>` +
    `<p style="margin:20px 0 0"><a href="${esc(alertInput.healthPageUrl)}" style="background:#111827;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:600">Open the Health view</a></p>` +
    `</div>`;
  return { subject, text, html };
}

function alertEmailParagraphs(alertInput: AiServiceAlertEmailInput, serviceName: string): string[] {
  if (alertInput.alertKind === "recovered") {
    return [
      `${serviceName} started working again at ${formatPacificTime(alertInput.nowIso)} PT.`,
      `It was down for ${describeDowntime(alertInput.downSinceIso, alertInput.nowIso)}, since ${formatPacificTime(alertInput.downSinceIso)} PT.`,
    ];
  }
  const failureKind = alertInput.failureKind ?? "unexpected_response";
  const paragraphs = [
    `Since ${formatPacificTime(alertInput.downSinceIso)} PT, ${whatBreaksForUsers[alertInput.service]}.`,
    whatToDo[failureKind](alertInput.service),
  ];
  if (alertInput.failureDetail) {
    paragraphs.push(`What ${serviceName} said: ${alertInput.failureDetail}`);
  }
  paragraphs.push("You will get one more email when it recovers.");
  return paragraphs;
}
