import { createSign } from "node:crypto";

// GA4 visitor funnel for the admin Growth page, via the Analytics Data API.
// Auth is a service account key (GA4_SERVICE_ACCOUNT_JSON, raw JSON or base64)
// signed into an RS256 JWT with node:crypto, so there is no Google SDK
// dependency. The service account needs Viewer on the GA4 property.

export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const DATA_API = "https://analyticsdata.googleapis.com/v1beta";

export type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

/** Accepts the key file as raw JSON or base64 of it; throws on anything else. */
export function parseServiceAccount(raw: string): ServiceAccount {
  const text = raw.trim();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    try {
      parsed = JSON.parse(Buffer.from(text, "base64").toString("utf8"));
    } catch {
      throw new Error("GA4_SERVICE_ACCOUNT_JSON is not valid JSON or base64 JSON");
    }
  }
  if (typeof parsed?.client_email !== "string" || typeof parsed?.private_key !== "string") {
    throw new Error("GA4_SERVICE_ACCOUNT_JSON is missing client_email or private_key");
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key, token_uri: parsed.token_uri };
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** The signed JWT assertion exchanged for an access token (valid one hour). */
export function buildJwt(sa: ServiceAccount, nowSec = Math.floor(Date.now() / 1000)): string {
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: GA4_SCOPE,
    aud: sa.token_uri || DEFAULT_TOKEN_URI,
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key);
  return `${unsigned}.${b64url(signature)}`;
}

let tokenCache: { email: string; token: string; expiresAt: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  // Reuse until five minutes before expiry.
  if (tokenCache && tokenCache.email === sa.client_email && Date.now() < tokenCache.expiresAt - 5 * 60_000) {
    return tokenCache.token;
  }
  const res = await fetch(sa.token_uri || DEFAULT_TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: buildJwt(sa),
    }),
    signal: AbortSignal.timeout(8_000),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`Google auth ${res.status}: ${body.error_description ?? body.error ?? "token request failed"}`);
  }
  tokenCache = { email: sa.client_email, token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return body.access_token;
}

// ─── Funnel ───────────────────────────────────────────────────────────────────

// Built from default page_view data, so no custom events are needed. Each step
// is its own report with a page filter: GA4 then counts each session once.
const pathFilter = (expressions: { matchType: "EXACT" | "BEGINS_WITH"; value: string }[]) => ({
  orGroup: {
    expressions: expressions.map((e) => ({
      filter: { fieldName: "pagePath", stringFilter: { matchType: e.matchType, value: e.value } },
    })),
  },
});

export const FUNNEL_STEPS = [
  { label: "Site visits", filter: null },
  { label: "Viewed the pack", filter: pathFilter([{ matchType: "EXACT", value: "/" }, { matchType: "BEGINS_WITH", value: "/drop" }]) },
  { label: "Started checkout", filter: pathFilter([{ matchType: "BEGINS_WITH", value: "/checkout" }]) },
  { label: "Purchased", filter: pathFilter([{ matchType: "BEGINS_WITH", value: "/success" }]) },
] as const;

/** One batchRunReports body: a daily sessions report, then one report per funnel step. */
export function funnelRequest(startDate: string, endDate: string) {
  const dateRanges = [{ startDate, endDate }];
  return {
    requests: [
      { dateRanges, dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }], metricAggregations: ["TOTAL"], limit: 500 },
      ...FUNNEL_STEPS.slice(1).map((s) => ({ dateRanges, metrics: [{ name: "sessions" }], dimensionFilter: s.filter })),
    ],
  };
}

export type FunnelStep = { label: string; sessions: number; pctOfPrevious: number | null };
export type Ga4Summary = {
  sessions: number;
  steps: FunnelStep[];
  conversion: number | null; // purchased sessions / all sessions
  daily: { date: string; sessions: number }[];
};

type Row = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] };
type Report = { rows?: Row[]; totals?: Row[] };

const num = (row: Row | undefined) => Number(row?.metricValues?.[0]?.value) || 0;

/** Shapes a batchRunReports response (built by funnelRequest) into funnel steps. */
export function parseFunnel(batch: { reports?: Report[] }, days: string[]): Ga4Summary {
  const [daily, ...steps] = batch.reports ?? [];

  const byDay = new Map(days.map((d) => [d, 0]));
  let summed = 0;
  for (const r of daily?.rows ?? []) {
    const raw = r.dimensionValues?.[0]?.value ?? ""; // YYYYMMDD
    const key = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    const v = num(r);
    summed += v;
    if (byDay.has(key)) byDay.set(key, byDay.get(key)! + v);
  }
  // The TOTAL aggregation counts a session spanning midnight once; fall back to the sum.
  const sessions = daily?.totals?.length ? num(daily.totals[0]) : summed;

  const counts = [sessions, ...FUNNEL_STEPS.slice(1).map((_, i) => num(steps[i]?.rows?.[0]))];
  const out: FunnelStep[] = FUNNEL_STEPS.map((s, i) => ({
    label: s.label,
    sessions: counts[i],
    pctOfPrevious: i === 0 ? null : counts[i - 1] ? (counts[i] / counts[i - 1]) * 100 : null,
  }));

  return {
    sessions,
    steps: out,
    conversion: sessions ? (counts[counts.length - 1] / sessions) * 100 : null,
    daily: [...byDay].map(([date, s]) => ({ date, sessions: s })),
  };
}

/** Fetches the funnel for the given business days (first..last, inclusive). */
export async function loadGa4Funnel(days: string[]): Promise<Ga4Summary> {
  const sa = parseServiceAccount(process.env.GA4_SERVICE_ACCOUNT_JSON ?? "");
  const property = process.env.GA4_PROPERTY_ID || "541136891";
  const token = await accessToken(sa);
  const res = await fetch(`${DATA_API}/properties/${encodeURIComponent(property)}:batchRunReports`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(funnelRequest(days[0], days[days.length - 1])),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { reports?: Report[]; error?: { message?: string } };
  if (!res.ok) throw new Error(`GA4 ${res.status}: ${body.error?.message ?? "report failed"}`);
  return parseFunnel(body, days);
}
