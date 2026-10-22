// Everything the shop depends on, and how its health reads in the admin Health
// and Map views. The report comes from GET /api/admin/dependency-health; the
// catalog below says how to show each dependency. Adding a dependency later is
// one line in DEPENDENCIES (plus its check in artifacts/api-server).
//
// The catalog lives in the front end, not the API, so the views can still draw
// everything when the API itself is down: then every dependency behind it shows
// grey "can't check while the API is down" instead of a stale green or red.

// ─── Report types (mirror artifacts/api-server/src/lib/dependencySummary.ts) ──

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

export type ReportStatus = "working" | "warning" | "down" | "unknown" | "never_checked";
export type TimelineSlot = "working" | "warning" | "down" | "no_data";

export type ReportService = {
  service: DependencyKey;
  displayName: string;
  currentStatus: ReportStatus;
  lastCheckedAtIso: string | null;
  lastLatencyMilliseconds: number | null;
  currentFailureSummary: string | null;
  currentFailureDetail: string | null;
  whatBreaksWhileDown: string;
  note: string | null;
  limitRemaining: number | null;
  limitUnit: string | null;
  uptimePercent: number | null;
  timelineSlots: TimelineSlot[];
};

export type ReportIncident = {
  service: DependencyKey;
  displayName: string;
  startedAtIso: string;
  endedAtIso: string | null;
  failureSummary: string;
  durationText: string;
};

export type SecretPresence = { label: string; present: boolean; note: string | null };

export type HealthReport = {
  generatedAt: string;
  windowStartIso: string;
  windowDays: number;
  lastFullCheckAtIso: string | null;
  services: ReportService[];
  incidentsNewestFirst: ReportIncident[];
  secrets: SecretPresence[];
  downCount: number;
  warningCount: number;
};

// ─── Catalog ──────────────────────────────────────────────────────────────────

export type DependencyGroup = "Shop and checkout" | "Shipping and email" | "Admin tools";

export type MapBox = { x: number; y: number; width: number; label: string; sub: string; from: DependencyKey | null };

export type DependencyEntry = { key: DependencyKey; name: string; powers: string; group: DependencyGroup; map: MapBox };

export const DEPENDENCIES: DependencyEntry[] = [
  { key: "api", name: "Railway API server", powers: "Checkout, orders, admin", group: "Shop and checkout", map: { x: 210, y: 27, width: 130, label: "API server", sub: "Railway", from: "site" } },
  { key: "site", name: "Vercel storefront", powers: "The shop itself", group: "Shop and checkout", map: { x: 10, y: 27, width: 110, label: "Storefront", sub: "Vercel", from: null } },
  { key: "stripe", name: "Stripe", powers: "Payments, order sync", group: "Shop and checkout", map: { x: 20, y: 120, width: 120, label: "Stripe", sub: "Payments", from: "api" } },
  { key: "db", name: "Supabase database", powers: "Orders, products, stock", group: "Shop and checkout", map: { x: 155, y: 120, width: 120, label: "Supabase", sub: "Orders, stock", from: "api" } },
  { key: "shippo", name: "Shippo", powers: "Shipping rates and labels", group: "Shipping and email", map: { x: 20, y: 200, width: 120, label: "Shippo", sub: "Rates, labels", from: "stripe" } },
  { key: "resend", name: "Resend", powers: "Order and alert emails", group: "Shipping and email", map: { x: 155, y: 200, width: 120, label: "Resend", sub: "Order emails", from: "db" } },
  { key: "sheets", name: "Google Sheets log", powers: "Order and signup log", group: "Shipping and email", map: { x: 155, y: 262, width: 120, label: "Sheets log", sub: "Order log", from: "resend" } },
  { key: "claude", name: "Anthropic (Claude)", powers: "Product write ups, Style It", group: "Admin tools", map: { x: 290, y: 120, width: 140, label: "Claude", sub: "Product write ups", from: "api" } },
  { key: "removebg", name: "remove.bg", powers: "Remove background", group: "Admin tools", map: { x: 290, y: 200, width: 140, label: "remove.bg", sub: "Backgrounds", from: "claude" } },
  { key: "cloudinary", name: "Cloudinary", powers: "Image uploads", group: "Admin tools", map: { x: 290, y: 262, width: 140, label: "Cloudinary", sub: "Image uploads", from: "removebg" } },
];

export const MAP_VIEWBOX = { width: 440, height: 310, boxHeight: 38 };

export const GROUP_ORDER: DependencyGroup[] = ["Shop and checkout", "Shipping and email", "Admin tools"];

type Outcome = { name: string; dependsOn: DependencyKey[]; whenDown: string };

const OUTCOMES: Outcome[] = [
  { name: "Checkout", dependsOn: ["api", "site", "stripe", "db", "shippo"], whenDown: "Customers can't check out" },
  { name: "Shipping and email", dependsOn: ["api", "shippo", "resend", "sheets"], whenDown: "Order emails or labels are failing" },
  { name: "Admin tools", dependsOn: ["api", "claude", "removebg", "cloudinary"], whenDown: "Some admin tools are failing" },
  { name: "Browsing the shop", dependsOn: ["site"], whenDown: "The shop doesn't load" },
];

// ─── View model (pure, unit tested) ───────────────────────────────────────────

export type ViewStatus = "working" | "warning" | "down" | "unknown" | "cant_check";

export type HealthRow = {
  key: DependencyKey;
  name: string;
  subtitle: string;
  group: DependencyGroup;
  status: ViewStatus;
  timelineSlots: TimelineSlot[];
  primary: string;
  secondary: string | null;
  map: MapBox;
};

export type Banner = { tone: "ok" | "warn" | "down" | "loading"; headline: string; body: string };

export type OutcomeRow = { label: string; status: ViewStatus; statusText: string };

export type HealthViewModel = {
  apiDown: boolean;
  rows: HealthRow[];
  banner: Banner;
  outcomes: OutcomeRow[];
  secrets: SecretPresence[];
  badgeCount: number;
};

export const CANT_CHECK_WHILE_API_DOWN = "Can't check while the API is down";

export function minutesAgo(instantIso: string, nowMilliseconds: number): string {
  const minutes = Math.max(0, Math.round((nowMilliseconds - Date.parse(instantIso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)} days ago`;
}

function durationSince(instantIso: string, nowMilliseconds: number): string {
  const minutes = Math.max(1, Math.round((nowMilliseconds - Date.parse(instantIso)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

function viewStatusFrom(reportStatus: ReportStatus | undefined): ViewStatus {
  if (reportStatus === "working" || reportStatus === "warning" || reportStatus === "down") return reportStatus;
  return "unknown";
}

function formatReplyTime(milliseconds: number): string {
  return milliseconds < 100 ? `${milliseconds}ms` : `${(milliseconds / 1000).toFixed(1)}s`;
}

function formatAmount(amount: number): string {
  return amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function rightSideText(service: ReportService | undefined, nowMilliseconds: number): { primary: string; secondary: string | null } {
  if (!service || service.currentStatus === "never_checked" || !service.lastCheckedAtIso) {
    return { primary: "not checked yet", secondary: null };
  }
  const checkedAgo = `checked ${minutesAgo(service.lastCheckedAtIso, nowMilliseconds)}`;
  if (service.limitRemaining !== null) {
    const afterAmount = service.note?.split(", ").slice(1).join(", ") || checkedAgo;
    return { primary: `${formatAmount(service.limitRemaining)} ${service.limitUnit ?? ""}`.trim(), secondary: afterAmount };
  }
  if (service.currentStatus === "down" || service.currentStatus === "unknown") {
    return { primary: service.currentFailureSummary ?? service.currentStatus, secondary: service.note ?? checkedAgo };
  }
  if (service.service === "sheets" && service.note) return { primary: service.note, secondary: null };
  const answered =
    service.lastLatencyMilliseconds !== null ? `answered in ${formatReplyTime(service.lastLatencyMilliseconds)}` : checkedAgo;
  return { primary: answered, secondary: service.note ?? (answered === checkedAgo ? null : checkedAgo) };
}

function outcomeFor(outcome: Outcome, statusByKey: Map<DependencyKey, ViewStatus>, apiDown: boolean): OutcomeRow {
  const statuses = outcome.dependsOn.map((key) => statusByKey.get(key) ?? "unknown");
  if (apiDown && outcome.dependsOn.includes("api")) {
    const label =
      outcome.name === "Shipping and email" ? "Order emails stop, labels can't be printed" : outcome.name === "Admin tools" ? "Admin tools can't reach the API" : outcome.whenDown;
    return { label, status: "down", statusText: "down" };
  }
  if (statuses.includes("down")) return { label: outcome.whenDown, status: "down", statusText: "down" };
  if (statuses.includes("warning")) return { label: outcome.name, status: "warning", statusText: "running low" };
  if (statuses.every((status) => status === "unknown" || status === "cant_check")) {
    return { label: outcome.name, status: "unknown", statusText: "can't check" };
  }
  return { label: outcome.name, status: "working", statusText: "working" };
}

function bannerFor(
  rows: HealthRow[],
  report: HealthReport | null,
  apiUnreachableSinceIso: string | null,
  nowMilliseconds: number,
): Banner {
  if (apiUnreachableSinceIso) {
    return {
      tone: "down",
      headline: "Railway API is down.",
      body: `No answer for ${durationSince(apiUnreachableSinceIso, nowMilliseconds)}. Customers can't check out. The outside check on Vercel emails you when it notices.`,
    };
  }
  if (!report) return { tone: "loading", headline: "Checking", body: "Loading the latest checks." };
  const down = rows.filter((row) => row.status === "down");
  if (down.length === 1) {
    const service = report.services.find((entry) => entry.service === down[0].key);
    return { tone: "down", headline: `${down[0].name} is down.`, body: `While it's down, ${service?.whatBreaksWhileDown ?? "part of the shop fails"}.` };
  }
  if (down.length > 1) {
    return { tone: "down", headline: `${down.length} things are down:`, body: `${down.map((row) => row.name).join(", ")}.` };
  }
  const low = rows.filter((row) => row.status === "warning");
  if (low.length) {
    const details = low.map((row) => `${row.name} has ${row.primary}${row.secondary ? `, ${row.secondary}` : ""}`).join("; ");
    return { tone: "warn", headline: `${low.length} ${low.length === 1 ? "thing" : "things"} running low:`, body: `${details}.` };
  }
  const lastCheck = report.lastFullCheckAtIso ? ` Last full check ${minutesAgo(report.lastFullCheckAtIso, nowMilliseconds)}.` : "";
  const checkedRows = rows.filter((row) => row.status === "working");
  return {
    tone: "ok",
    headline: "",
    body: checkedRows.length === rows.length ? `All ${rows.length} dependencies working.${lastCheck}` : `${checkedRows.length} of ${rows.length} dependencies working, the rest can't be checked yet.${lastCheck}`,
  };
}

export function buildHealthViewModel(
  report: HealthReport | null,
  apiUnreachableSinceIso: string | null,
  nowMilliseconds: number,
): HealthViewModel {
  const apiDown = apiUnreachableSinceIso !== null;
  const serviceByKey = new Map((report?.services ?? []).map((service) => [service.service, service]));
  const rows = DEPENDENCIES.map((entry): HealthRow => {
    const service = serviceByKey.get(entry.key);
    const base = { key: entry.key, name: entry.name, group: entry.group, map: entry.map, timelineSlots: service?.timelineSlots ?? [] };
    if (apiDown && entry.key === "api") {
      return { ...base, subtitle: entry.powers, status: "down", primary: `no answer for ${durationSince(apiUnreachableSinceIso, nowMilliseconds)}`, secondary: null };
    }
    if (apiDown && entry.key === "site") {
      return { ...base, subtitle: entry.powers, status: "working", primary: "loading this page", secondary: null };
    }
    if (apiDown) {
      return { ...base, subtitle: CANT_CHECK_WHILE_API_DOWN, status: "cant_check", primary: "", secondary: null };
    }
    const { primary, secondary } = rightSideText(service, nowMilliseconds);
    return { ...base, subtitle: entry.powers, status: viewStatusFrom(service?.currentStatus), primary, secondary };
  });
  const statusByKey = new Map(rows.map((row) => [row.key, row.status]));
  return {
    apiDown,
    rows,
    banner: bannerFor(rows, report, apiUnreachableSinceIso, nowMilliseconds),
    outcomes: OUTCOMES.map((outcome) => outcomeFor(outcome, statusByKey, apiDown)),
    secrets: apiDown ? [] : report?.secrets ?? [],
    badgeCount: apiDown ? 1 : rows.filter((row) => row.status === "down").length,
  };
}

export function rowsByGroup(rows: HealthRow[]): { group: DependencyGroup; rows: HealthRow[] }[] {
  return GROUP_ORDER.map((group) => ({ group, rows: rows.filter((row) => row.group === group) }));
}

export type MapLine = { key: DependencyKey; x1: number; y1: number; x2: number; y2: number };

export function mapLines(rows: HealthRow[]): MapLine[] {
  const boxByKey = new Map(rows.map((row) => [row.key, row.map]));
  const height = MAP_VIEWBOX.boxHeight;
  return rows.flatMap((row) => {
    const parent = row.map.from ? boxByKey.get(row.map.from) : undefined;
    if (!parent) return [];
    if (parent.y === row.map.y) {
      return [{ key: row.key, x1: parent.x + parent.width, y1: parent.y + height / 2, x2: row.map.x, y2: row.map.y + height / 2 }];
    }
    return [{ key: row.key, x1: parent.x + parent.width / 2, y1: parent.y + height, x2: row.map.x + row.map.width / 2, y2: row.map.y }];
  });
}
