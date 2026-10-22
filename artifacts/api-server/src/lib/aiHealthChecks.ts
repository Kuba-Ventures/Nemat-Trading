// Live checks of the AI services the API calls at runtime, using the real keys.
// Anthropic has no API for remaining prepaid credit, so a tiny real request is
// the only reliable signal that the key still works. Copied from Telly's design
// (voice-agent site/lib/aiHealth) and adapted to the two services this shop uses.

export type AiServiceName = "claude" | "removebg";

export const allAiServiceNames: AiServiceName[] = ["claude", "removebg"];

export type AiServiceStatus = "working" | "down" | "unknown";

export type AiServiceFailureKind =
  | "out_of_credits"
  | "out_of_quota"
  | "key_rejected"
  | "key_not_allowed"
  | "rate_limited"
  | "provider_outage"
  | "unreachable"
  | "unexpected_response"
  | "not_configured"
  | "cannot_check";

export type AiServiceCheckResult = {
  service: AiServiceName;
  status: AiServiceStatus;
  failureKind: AiServiceFailureKind | null;
  failureDetail: string | null;
  latencyMilliseconds: number | null;
};

const checkTimeoutMilliseconds = 15_000;
const claudeProbeModel = "claude-haiku-5-5";

type AnthropicErrorBody = { error?: { type?: string; message?: string } };

export function classifyAnthropicFailure(httpStatus: number, errorBody: AnthropicErrorBody | null): AiServiceFailureKind {
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
export function classifyRemoveBgAccount(
  httpStatus: number,
  responseBody: RemoveBgAccountBody | null,
): { status: AiServiceStatus; failureKind: AiServiceFailureKind | null } {
  if (httpStatus === 402) return { status: "down", failureKind: "out_of_credits" };
  if (httpStatus === 401 || httpStatus === 403) return { status: "down", failureKind: "key_rejected" };
  if (httpStatus === 429) return { status: "down", failureKind: "rate_limited" };
  if (httpStatus >= 500) return { status: "down", failureKind: "provider_outage" };
  if (httpStatus < 200 || httpStatus > 299) return { status: "down", failureKind: "unexpected_response" };
  const creditsLeft = responseBody?.data?.attributes?.credits?.total;
  if (typeof creditsLeft !== "number") return { status: "unknown", failureKind: "cannot_check" };
  if (creditsLeft < 1) return { status: "down", failureKind: "out_of_credits" };
  return { status: "working", failureKind: null };
}

function failureDetailFrom(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : "request failed";
}

function notConfiguredResult(service: AiServiceName, environmentVariableName: string): AiServiceCheckResult {
  return {
    service,
    status: "unknown",
    failureKind: "not_configured",
    failureDetail: `${environmentVariableName} is not set`,
    latencyMilliseconds: null,
  };
}

function unreachableResult(service: AiServiceName, error: unknown, checkStartedAt: number): AiServiceCheckResult {
  return {
    service,
    status: "down",
    failureKind: "unreachable",
    failureDetail: failureDetailFrom(error),
    latencyMilliseconds: Date.now() - checkStartedAt,
  };
}

async function parseJsonOrNull<BodyType>(response: Response): Promise<BodyType | null> {
  try {
    return (await response.json()) as BodyType;
  } catch {
    return null;
  }
}

export async function checkClaude(): Promise<AiServiceCheckResult> {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) return notConfiguredResult("claude", "ANTHROPIC_API_KEY");
  const checkStartedAt = Date.now();
  try {
    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: claudeProbeModel,
        max_tokens: 1,
        messages: [{ role: "user", content: "ok" }],
      }),
      signal: AbortSignal.timeout(checkTimeoutMilliseconds),
    });
    const latencyMilliseconds = Date.now() - checkStartedAt;
    if (anthropicResponse.ok) {
      return { service: "claude", status: "working", failureKind: null, failureDetail: null, latencyMilliseconds };
    }
    const errorBody = await parseJsonOrNull<AnthropicErrorBody>(anthropicResponse);
    return {
      service: "claude",
      status: "down",
      failureKind: classifyAnthropicFailure(anthropicResponse.status, errorBody),
      failureDetail: `${anthropicResponse.status}: ${(errorBody?.error?.message ?? "no message").slice(0, 200)}`,
      latencyMilliseconds,
    };
  } catch (error) {
    return unreachableResult("claude", error, checkStartedAt);
  }
}

// GET /v1.0/account is free: it reads the credit balance without processing an image.
export async function checkRemoveBg(): Promise<AiServiceCheckResult> {
  const removeBgApiKey = process.env.REMOVE_BG_API_KEY;
  if (!removeBgApiKey) return notConfiguredResult("removebg", "REMOVE_BG_API_KEY");
  const checkStartedAt = Date.now();
  try {
    const accountResponse = await fetch("https://api.remove.bg/v1.0/account", {
      headers: { "X-Api-Key": removeBgApiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(checkTimeoutMilliseconds),
    });
    const latencyMilliseconds = Date.now() - checkStartedAt;
    const accountBody = await parseJsonOrNull<RemoveBgAccountBody>(accountResponse);
    const { status, failureKind } = classifyRemoveBgAccount(accountResponse.status, accountBody);
    const creditsLeft = accountBody?.data?.attributes?.credits?.total;
    const failureDetail =
      failureKind === null
        ? null
        : failureKind === "out_of_credits" && typeof creditsLeft === "number"
          ? `${creditsLeft} credits left`
          : `${accountResponse.status}: ${(accountBody?.errors?.[0]?.title ?? "no message").slice(0, 200)}`;
    return { service: "removebg", status, failureKind, failureDetail, latencyMilliseconds };
  } catch (error) {
    return unreachableResult("removebg", error, checkStartedAt);
  }
}

export async function checkAllAiServices(): Promise<AiServiceCheckResult[]> {
  return Promise.all([checkClaude(), checkRemoveBg()]);
}
