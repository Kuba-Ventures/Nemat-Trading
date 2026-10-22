// Live checks of every service the shop depends on, using the real keys. Each one
// is the cheapest authenticated read the service offers: nothing is charged, no
// label is bought, no email is sent and no row is written anywhere but our own
// ai_service_checks table. Anthropic has no API for remaining prepaid credit, so
// a one token request is the only reliable signal that its key still works.
//
// "api" (the Railway API server itself) is not checked here: it can't watch
// itself, so the outside watcher on Vercel (artifacts/nemat-drop/api) checks it
// and records its rows in the same table.

export type DependencyKey =
  | "api"
  | "site"
  | "stripe"
  | "db"
  | "shippo"
  | "resend"
  | "sheets"
  | "claude"
  | "removebg"
  | "cloudinary";

export const allDependencyKeys: DependencyKey[] = [
  "api",
  "site",
  "stripe",
  "db",
  "shippo",
  "resend",
  "sheets",
  "claude",
  "removebg",
  "cloudinary",
];

export const SHEETS_WEBHOOK_CALL = "sheets_webhook_call";

export type DependencyStatus = "working" | "warning" | "down" | "unknown";

export type DependencyFailureKind =
  | "out_of_credits"
  | "out_of_quota"
  | "running_low"
  | "key_rejected"
  | "key_not_allowed"
  | "domain_not_verified"
  | "rate_limited"
  | "provider_outage"
  | "unreachable"
  | "checks_stopped"
  | "unexpected_response"
  | "not_configured"
  | "cannot_check"
  | "no_recent_activity";

export type DependencyCheckResult = {
  service: DependencyKey;
  status: DependencyStatus;
  failureKind: DependencyFailureKind | null;
  failureDetail: string | null;
  latencyMilliseconds: number | null;
  limitRemaining: number | null;
  limitUnit: string | null;
  note: string | null;
};

type Classified = { status: DependencyStatus; failureKind: DependencyFailureKind | null };

const checkTimeoutMilliseconds = 15_000;
const claudeProbeModel = "claude-haiku-5-5";
const defaultSendingAddress = "orders@tommytopdecker.com";
// Public values: both ship in the storefront bundle (VITE_CLOUDINARY_* on Vercel).
const defaultCloudinaryCloudName = "djggnxvt0";
const defaultCloudinaryUploadPreset = "Nemat_Trading";

const working: Classified = { status: "working", failureKind: null };
const down = (failureKind: DependencyFailureKind): Classified => ({ status: "down", failureKind });
const unknown = (failureKind: DependencyFailureKind): Classified => ({ status: "unknown", failureKind });

function classifyCommonHttpFailure(httpStatus: number): Classified {
  if (httpStatus === 401) return down("key_rejected");
  if (httpStatus === 403) return down("key_not_allowed");
  if (httpStatus === 429) return down("rate_limited");
  if (httpStatus >= 500) return down("provider_outage");
  return down("unexpected_response");
}

// ─── Classification (pure, unit tested) ───────────────────────────────────────

type AnthropicErrorBody = { error?: { type?: string; message?: string } };

export function classifyAnthropicFailure(httpStatus: number, errorBody: AnthropicErrorBody | null): DependencyFailureKind {
  const errorType = errorBody?.error?.type ?? "";
  const errorMessage = (errorBody?.error?.message ?? "").toLowerCase();
  if (errorMessage.includes("credit balance")) return "out_of_credits";
  if (httpStatus === 401 || errorType === "authentication_error") return "key_rejected";
  if (httpStatus === 403 || errorType === "permission_error") return "key_not_allowed";
  if (httpStatus === 429 || errorType === "rate_limit_error") return "rate_limited";
  if (httpStatus >= 500 || errorType === "overloaded_error" || errorType === "api_error") return "provider_outage";
  return "unexpected_response";
}

export type RemoveBgAccountBody = {
  data?: { attributes?: { credits?: { total?: number }; api?: { free_calls?: number } } };
  errors?: { title?: string; code?: string }[];
};

// The shop asks remove.bg for size "auto", which costs a full credit per image,
// so a balance under one credit means the next background removal fails. Free
// calls only cover preview-size images and don't help.
export function classifyRemoveBgAccount(httpStatus: number, responseBody: RemoveBgAccountBody | null): Classified {
  if (httpStatus === 402) return down("out_of_credits");
  if (httpStatus === 401 || httpStatus === 403) return down("key_rejected");
  if (httpStatus < 200 || httpStatus > 299) return classifyCommonHttpFailure(httpStatus);
  const creditsLeft = responseBody?.data?.attributes?.credits?.total;
  if (typeof creditsLeft !== "number") return unknown("cannot_check");
  if (creditsLeft < 1) return down("out_of_credits");
  return working;
}

// A restricted Stripe key without balance access gets a 403 but can still take
// payments, so that is "can't check", not down.
export function classifyStripeBalance(httpStatus: number): Classified {
  if (httpStatus >= 200 && httpStatus <= 299) return working;
  if (httpStatus === 403) return unknown("cannot_check");
  return classifyCommonHttpFailure(httpStatus);
}

export function classifyShippoList(httpStatus: number): Classified {
  if (httpStatus >= 200 && httpStatus <= 299) return working;
  if (httpStatus === 402) return down("out_of_credits");
  return classifyCommonHttpFailure(httpStatus);
}

export type ResendDomainsBody = {
  data?: { name?: string; status?: string }[];
  name?: string;
  message?: string;
};

// A sending-only Resend key can't list domains (restricted_api_key) but still
// sends, so that is "can't check", not down.
export function classifyResendDomains(
  httpStatus: number,
  responseBody: ResendDomainsBody | null,
  sendingDomain: string,
): Classified {
  if (responseBody?.name === "restricted_api_key") return unknown("cannot_check");
  if (httpStatus === 400 && /api key is invalid/i.test(responseBody?.message ?? "")) return down("key_rejected");
  if (httpStatus < 200 || httpStatus > 299) return classifyCommonHttpFailure(httpStatus);
  const domain = responseBody?.data?.find((entry) => entry.name?.toLowerCase() === sendingDomain.toLowerCase());
  if (!domain || domain.status !== "verified") return down("domain_not_verified");
  return working;
}

export function sendingDomainFrom(fromAddress: string): string {
  const address = fromAddress.match(/<([^>]+)>/)?.[1] ?? fromAddress;
  return address.split("@")[1]?.trim().toLowerCase() ?? "";
}

export function classifyStorefrontResponse(httpStatus: number): Classified {
  if (httpStatus >= 200 && httpStatus <= 399) return working;
  if (httpStatus >= 500) return down("provider_outage");
  return down("unexpected_response");
}

// An unsigned upload with a preset and no file is rejected before anything is
// stored: "Missing required parameter - file" proves the cloud name and preset
// are good. Usage needs the API secret, which the shop doesn't have, so usage is
// never what makes this down.
export function classifyCloudinaryProbe(httpStatus: number, errorMessage: string): Classified {
  if (/missing required parameter - file/i.test(errorMessage)) return working;
  if (/upload preset/i.test(errorMessage)) return down("key_not_allowed");
  if (httpStatus === 401 || /unknown api key|cloud_name/i.test(errorMessage)) return down("key_rejected");
  if (httpStatus === 420 || httpStatus === 429) return down("rate_limited");
  if (httpStatus >= 500) return down("provider_outage");
  return down("unexpected_response");
}

export type SheetsWebhookCall = { calledAt: string; ok: boolean; error: string | null };

// The sheet is only written when an order or signup happens, and posting a test
// row would put fake data in the client's log, so this reads the last real call.
// No call yet is unknown, never down.
export function classifySheetsWebhookCall(lastCall: SheetsWebhookCall | null, webhookUrlIsSet: boolean): Classified {
  if (!webhookUrlIsSet) return unknown("not_configured");
  if (!lastCall) return unknown("no_recent_activity");
  if (lastCall.ok) return working;
  if (/unauthorized|login|who has access/i.test(lastCall.error ?? "")) return down("key_rejected");
  return down("unexpected_response");
}

export function describeTimeAgo(instantIso: string, nowMilliseconds: number): string {
  const minutes = Math.max(0, Math.round((nowMilliseconds - Date.parse(instantIso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// ─── Live checks ──────────────────────────────────────────────────────────────

function resultFrom(
  service: DependencyKey,
  classified: Classified,
  latencyMilliseconds: number | null,
  failureDetail: string | null,
  extra: Partial<DependencyCheckResult> = {},
): DependencyCheckResult {
  return {
    service,
    ...classified,
    latencyMilliseconds,
    failureDetail: classified.failureKind ? failureDetail : null,
    limitRemaining: null,
    limitUnit: null,
    note: null,
    ...extra,
  };
}

function notConfiguredResult(service: DependencyKey, environmentVariableName: string): DependencyCheckResult {
  return resultFrom(service, unknown("not_configured"), null, `${environmentVariableName} is not set`);
}

function unreachableResult(service: DependencyKey, error: unknown, checkStartedAt: number): DependencyCheckResult {
  const detail = error instanceof Error ? error.message.slice(0, 200) : "request failed";
  return resultFrom(service, down("unreachable"), Date.now() - checkStartedAt, detail);
}

async function parseJsonOrNull<BodyType>(response: Response): Promise<BodyType | null> {
  try {
    return (await response.json()) as BodyType;
  } catch {
    return null;
  }
}

async function timedFetch(
  service: DependencyKey,
  url: string,
  init: RequestInit,
  onResponse: (response: Response, latencyMilliseconds: number) => Promise<DependencyCheckResult>,
): Promise<DependencyCheckResult> {
  const checkStartedAt = Date.now();
  try {
    const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(checkTimeoutMilliseconds) });
    return await onResponse(response, Date.now() - checkStartedAt);
  } catch (error) {
    return unreachableResult(service, error, checkStartedAt);
  }
}

export async function checkClaude(): Promise<DependencyCheckResult> {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) return notConfiguredResult("claude", "ANTHROPIC_API_KEY");
  return timedFetch(
    "claude",
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: { "x-api-key": anthropicApiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: claudeProbeModel, max_tokens: 1, messages: [{ role: "user", content: "ok" }] }),
    },
    async (response, latencyMilliseconds) => {
      if (response.ok) return resultFrom("claude", working, latencyMilliseconds, null);
      const errorBody = await parseJsonOrNull<AnthropicErrorBody>(response);
      return resultFrom(
        "claude",
        down(classifyAnthropicFailure(response.status, errorBody)),
        latencyMilliseconds,
        `${response.status}: ${(errorBody?.error?.message ?? "no message").slice(0, 200)}`,
      );
    },
  );
}

// GET /v1.0/account is free: it reads the credit balance without processing an image.
export async function checkRemoveBg(): Promise<DependencyCheckResult> {
  const removeBgApiKey = process.env.REMOVE_BG_API_KEY;
  if (!removeBgApiKey) return notConfiguredResult("removebg", "REMOVE_BG_API_KEY");
  return timedFetch(
    "removebg",
    "https://api.remove.bg/v1.0/account",
    { headers: { "X-Api-Key": removeBgApiKey, Accept: "application/json" } },
    async (response, latencyMilliseconds) => {
      const accountBody = await parseJsonOrNull<RemoveBgAccountBody>(response);
      const classified = classifyRemoveBgAccount(response.status, accountBody);
      const creditsLeft = accountBody?.data?.attributes?.credits?.total;
      const detail =
        classified.failureKind === "out_of_credits" && typeof creditsLeft === "number"
          ? `${creditsLeft} credits left`
          : `${response.status}: ${(accountBody?.errors?.[0]?.title ?? "no message").slice(0, 200)}`;
      return resultFrom("removebg", classified, latencyMilliseconds, detail, {
        limitRemaining: typeof creditsLeft === "number" ? creditsLeft : null,
        limitUnit: typeof creditsLeft === "number" ? "credits" : null,
      });
    },
  );
}

export async function checkStripe(): Promise<DependencyCheckResult> {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) return notConfiguredResult("stripe", "STRIPE_SECRET_KEY");
  return timedFetch(
    "stripe",
    "https://api.stripe.com/v1/balance",
    { headers: { Authorization: `Bearer ${stripeSecretKey}` } },
    async (response, latencyMilliseconds) => {
      const body = await parseJsonOrNull<{ error?: { message?: string } }>(response);
      return resultFrom(
        "stripe",
        classifyStripeBalance(response.status),
        latencyMilliseconds,
        `${response.status}: ${(body?.error?.message ?? "no message").slice(0, 200)}`,
      );
    },
  );
}

export async function checkShippo(): Promise<DependencyCheckResult> {
  const shippoApiToken = process.env.SHIPPO_API_TOKEN;
  if (!shippoApiToken) return notConfiguredResult("shippo", "SHIPPO_API_TOKEN");
  return timedFetch(
    "shippo",
    "https://api.goshippo.com/carrier_accounts/?results=1",
    { headers: { Authorization: `ShippoToken ${shippoApiToken}` } },
    async (response, latencyMilliseconds) => {
      const body = await parseJsonOrNull<{ detail?: string }>(response);
      return resultFrom(
        "shippo",
        classifyShippoList(response.status),
        latencyMilliseconds,
        `${response.status}: ${(body?.detail ?? "no message").slice(0, 200)}`,
      );
    },
  );
}

export async function checkResend(): Promise<DependencyCheckResult> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) return notConfiguredResult("resend", "RESEND_API_KEY");
  const sendingDomain = sendingDomainFrom(process.env.ORDER_EMAIL_FROM || defaultSendingAddress);
  return timedFetch(
    "resend",
    "https://api.resend.com/domains",
    { headers: { Authorization: `Bearer ${resendApiKey}` } },
    async (response, latencyMilliseconds) => {
      const body = await parseJsonOrNull<ResendDomainsBody>(response);
      const classified = classifyResendDomains(response.status, body, sendingDomain);
      const domainStatus = body?.data?.find((entry) => entry.name?.toLowerCase() === sendingDomain)?.status;
      const detail =
        classified.failureKind === "domain_not_verified"
          ? `${sendingDomain} is ${domainStatus ?? "not set up"} in Resend`
          : `${response.status}: ${(body?.message ?? "no message").slice(0, 200)}`;
      return resultFrom("resend", classified, latencyMilliseconds, detail);
    },
  );
}

export async function checkStorefront(): Promise<DependencyCheckResult> {
  const storefrontUrl = (process.env.FRONTEND_URL ?? "").split(",")[0].trim();
  if (!storefrontUrl) return notConfiguredResult("site", "FRONTEND_URL");
  return timedFetch("site", storefrontUrl, { redirect: "follow" }, async (response, latencyMilliseconds) =>
    resultFrom("site", classifyStorefrontResponse(response.status), latencyMilliseconds, `${response.status} from ${storefrontUrl}`),
  );
}

export async function checkCloudinary(): Promise<DependencyCheckResult> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || defaultCloudinaryCloudName;
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || defaultCloudinaryUploadPreset;
  const probeForm = new FormData();
  probeForm.append("upload_preset", uploadPreset);
  return timedFetch(
    "cloudinary",
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
    { method: "POST", body: probeForm },
    async (response, latencyMilliseconds) => {
      const body = await parseJsonOrNull<{ error?: { message?: string } }>(response);
      const errorMessage = body?.error?.message ?? "";
      return resultFrom(
        "cloudinary",
        classifyCloudinaryProbe(response.status, errorMessage),
        latencyMilliseconds,
        `${response.status}: ${(errorMessage || "no message").slice(0, 200)}`,
        { note: "Can't check usage without an API secret" },
      );
    },
  );
}

export async function checkDatabase(runSelectOne: () => Promise<unknown>): Promise<DependencyCheckResult> {
  const checkStartedAt = Date.now();
  try {
    await runSelectOne();
    return resultFrom("db", working, Date.now() - checkStartedAt, null);
  } catch (error) {
    return unreachableResult("db", error, checkStartedAt);
  }
}

export function checkSheets(lastCall: SheetsWebhookCall | null, webhookUrlIsSet: boolean, nowMilliseconds: number): DependencyCheckResult {
  const classified = classifySheetsWebhookCall(lastCall, webhookUrlIsSet);
  const note = lastCall
    ? lastCall.ok
      ? `Last worked ${describeTimeAgo(lastCall.calledAt, nowMilliseconds)}`
      : `Last call failed ${describeTimeAgo(lastCall.calledAt, nowMilliseconds)}`
    : "No order or signup has reached the sheet since checks began";
  const detail = classified.failureKind === "not_configured" ? "SHEETS_WEBHOOK_URL is not set" : lastCall?.error ?? null;
  return resultFrom("sheets", classified, null, detail, { note });
}
