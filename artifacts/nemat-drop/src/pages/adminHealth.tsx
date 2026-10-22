import { useCallback, useEffect, useRef, useState } from "react";

// Health view for /admin, fed by GET /api/admin/ai-health. The API checks every
// AI service the shop calls (Claude, remove.bg) every 10 minutes with the real
// keys and emails the team when one goes down and again when it recovers.

// ─── Types (mirror artifacts/api-server/src/lib/aiHealthSummary.ts) ──────────

type ServiceStatus = "working" | "down" | "unknown" | "never_checked";
type TimelineSlot = "working" | "down" | "no_data";

type HealthService = {
  service: string;
  displayName: string;
  currentStatus: ServiceStatus;
  lastCheckedAtIso: string | null;
  lastLatencyMilliseconds: number | null;
  currentFailureSummary: string | null;
  currentFailureDetail: string | null;
  whatBreaksWhileDown: string;
  uptimePercent: number | null;
  timelineSlots: TimelineSlot[];
};

type HealthIncident = {
  service: string;
  displayName: string;
  startedAtIso: string;
  endedAtIso: string | null;
  failureSummary: string;
  durationText: string;
};

export type AiHealthReport = {
  generatedAt: string;
  windowStartIso: string;
  windowDays: number;
  services: HealthService[];
  incidentsNewestFirst: HealthIncident[];
  downCount: number;
};

export type AiHealthLoader = () => Promise<AiHealthReport>;

const POLL_MS = 60_000;

// ─── Data hook (shared by the banner, the nav badge and the view) ───────────

export function useAiHealth(load: AiHealthLoader, enabled: boolean) {
  const [report, setReport] = useState<AiHealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  const refresh = useCallback(() => {
    const requestNumber = ++sequence.current;
    return load()
      .then((loaded) => { if (requestNumber === sequence.current) { setReport(loaded); setError(null); } })
      .catch((err) => { if (requestNumber === sequence.current) setError(err?.message ?? "Couldn't load health checks"); });
  }, [load]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    return () => {
      sequence.current++;
      window.clearInterval(poll);
    };
  }, [enabled, refresh]);

  return { report, error, refresh };
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const pacificTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function relativeTime(iso: string, nowMs: number): string {
  const minutes = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const STATUS_DOT: Record<ServiceStatus, string> = {
  working: "bg-emerald-400",
  down: "bg-red-400",
  unknown: "bg-amber-400",
  never_checked: "bg-gray-500",
};

const SLOT_COLOR: Record<TimelineSlot, string> = {
  working: "bg-emerald-500/70",
  down: "bg-red-400",
  no_data: "bg-white/[0.06]",
};

function statusLine(service: HealthService, nowMs: number): string {
  if (service.currentStatus === "never_checked" || !service.lastCheckedAtIso) {
    return "Not checked yet. The first check runs within 10 minutes of the API starting.";
  }
  const checked = `checked ${relativeTime(service.lastCheckedAtIso, nowMs)}`;
  if (service.currentStatus === "working") {
    const reply = service.lastLatencyMilliseconds != null ? `, answered in ${(service.lastLatencyMilliseconds / 1000).toFixed(1)}s` : "";
    return `Working, ${checked}${reply}`;
  }
  const why = service.currentFailureSummary ?? "the check could not tell";
  return service.currentStatus === "down" ? `Down: ${why}, ${checked}` : `Unknown: ${why}, ${checked}`;
}

// ─── Banner shown on every admin page while something is down ───────────────

export function AiHealthDownBanner({ report, onOpen }: { report: AiHealthReport | null; onOpen: () => void }) {
  const down = report?.services.filter((s) => s.currentStatus === "down") ?? [];
  if (!down.length) return null;
  return (
    <div className="mb-6 flex flex-col gap-2">
      {down.map((s) => (
        <button
          key={s.service}
          onClick={onOpen}
          className="flex w-full items-center gap-3 rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-left text-sm text-red-200 transition-colors hover:border-red-400"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-red-400" />
          <span className="min-w-0 flex-1">
            <strong className="text-red-100">{s.displayName} is down.</strong>{" "}
            {s.currentFailureSummary ? `It says ${s.currentFailureSummary}. ` : ""}
            {s.lastCheckedAtIso ? `Last checked ${pacificTime(s.lastCheckedAtIso)} PT.` : ""}
          </span>
          <span className="shrink-0 font-semibold text-red-300">Health →</span>
        </button>
      ))}
    </div>
  );
}

// ─── Health view ──────────────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return <section className="min-w-0 rounded-lg border border-white/10 bg-white/[0.03] p-4">{children}</section>;
}

function ServiceCard({ service, windowStartIso, windowDays, nowMs }: {
  service: HealthService;
  windowStartIso: string;
  windowDays: number;
  nowMs: number;
}) {
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[service.currentStatus]}`} />
        <span className="text-base font-bold text-white">{service.displayName}</span>
        <span className="text-sm text-gray-400">{statusLine(service, nowMs)}</span>
        <span className="w-full text-sm tabular-nums text-gray-300 sm:ml-auto sm:w-auto">
          {service.uptimePercent == null ? "No data yet" : `${service.uptimePercent}% up, ${windowDays} days`}
        </span>
      </div>
      {service.currentStatus === "down" && (
        <div className="mb-3 rounded-md bg-red-500/10 px-3 py-2.5 text-sm leading-relaxed text-red-200">
          While this is down, {service.whatBreaksWhileDown}.
          {service.currentFailureDetail ? ` ${service.displayName} said: ${service.currentFailureDetail}` : ""}
        </div>
      )}
      <div className="flex gap-[2px]" aria-label={`${service.displayName} checks over the last ${windowDays} days`}>
        {service.timelineSlots.map((slot, index) => (
          <span key={index} className={`h-[22px] flex-1 rounded-[2px] ${SLOT_COLOR[slot]}`} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-gray-500">
        <span>{pacificTime(windowStartIso)} PT</span>
        <span>now</span>
      </div>
    </Card>
  );
}

export function HealthView({ report, error, onRefresh }: { report: AiHealthReport | null; error: string | null; onRefresh: () => void }) {
  const [refreshing, setRefreshing] = useState(false);
  const nowMs = Date.now();

  async function refreshNow() {
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Health</h1>
          <p className="mt-1 text-sm text-gray-500">Checks every AI service the shop depends on every 10 minutes, with its real keys.</p>
        </div>
        <button
          onClick={refreshNow}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:border-cyan-400/50 disabled:opacity-60"
        >
          {refreshing ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">Couldn't load: {error}</p>}
      {!report && !error && <p className="text-sm text-gray-500">Loading...</p>}

      {report?.services.map((service) => (
        <ServiceCard key={service.service} service={service} windowStartIso={report.windowStartIso} windowDays={report.windowDays} nowMs={nowMs} />
      ))}

      {report && (
        <Card>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">Incidents, last {report.windowDays} days</h2>
          {report.incidentsNewestFirst.length === 0 ? (
            <p className="text-sm text-gray-500">No incidents.</p>
          ) : (
            <ul>
              {report.incidentsNewestFirst.map((incident) => (
                <li key={`${incident.service}-${incident.startedAtIso}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-t border-white/5 py-2 text-sm first:border-t-0">
                  <span className="text-white">
                    {incident.displayName}: {incident.failureSummary}.{" "}
                    {incident.endedAtIso === null ? `Ongoing for ${incident.durationText}.` : `Down for ${incident.durationText}.`}
                  </span>
                  <span className={`tabular-nums ${incident.endedAtIso === null ? "text-red-400" : "text-gray-500"}`}>
                    {pacificTime(incident.startedAtIso)} PT
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-gray-500">
            An email goes to the team the moment a service goes down and again when it recovers. Running out of credit or a
            rejected key alerts on the first failed check; outages wait for a second check so a blip doesn't page anyone.
            Anthropic has no API for prepaid credit left, so this live check is what catches running out.
          </p>
        </Card>
      )}
    </div>
  );
}
