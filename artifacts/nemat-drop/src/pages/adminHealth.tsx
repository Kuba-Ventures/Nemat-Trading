import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAP_VIEWBOX,
  buildHealthViewModel,
  mapLines,
  rowsByGroup,
  type Banner,
  type HealthReport,
  type HealthRow,
  type HealthViewModel,
  type TimelineSlot,
  type ViewStatus,
} from "@/lib/dependencyHealth";

// Health (list) and Map views for /admin, fed by GET /api/admin/dependency-health.
// Designs picked by the owner from the 2026-10-21 mockups: option A (everything
// in one list) for Health and option B (map of what customers use) for Map.

export type HealthLoader = () => Promise<HealthReport>;

// Thrown by the loader when the API itself doesn't answer, as opposed to the API
// answering with an error. Only this one turns the views into "API is down".
export class ApiUnreachableError extends Error {}

const POLL_MS = 60_000;

// ─── Data hook (shared by the banner, the nav badge and both views) ──────────

export function useDependencyHealth(load: HealthLoader, enabled: boolean) {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiUnreachableSinceIso, setApiUnreachableSinceIso] = useState<string | null>(null);
  const [tickCount, tick] = useState(0);
  const sequence = useRef(0);

  const refresh = useCallback(() => {
    const requestNumber = ++sequence.current;
    return load()
      .then((loaded) => {
        if (requestNumber !== sequence.current) return;
        setReport(loaded);
        setError(null);
        setApiUnreachableSinceIso(null);
      })
      .catch((err) => {
        if (requestNumber !== sequence.current) return;
        if (err instanceof ApiUnreachableError) {
          setApiUnreachableSinceIso((since) => since ?? new Date().toISOString());
        } else {
          setError(err?.message ?? "Couldn't load health checks");
        }
      });
  }, [load]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    const ticker = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => {
      sequence.current++;
      window.clearInterval(poll);
      window.clearInterval(ticker);
    };
  }, [enabled, refresh]);

  const model = useMemo(
    () => buildHealthViewModel(report, apiUnreachableSinceIso, Date.now()),
    // tickCount re-renders the relative times ("3m ago") between polls.
    [report, apiUnreachableSinceIso, tickCount],
  );
  return { report, model, error, refresh };
}

// ─── Building blocks ──────────────────────────────────────────────────────────

const DOT: Record<ViewStatus, string> = {
  working: "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]",
  warning: "bg-amber-400",
  down: "bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.7)]",
  unknown: "bg-gray-500",
  cant_check: "bg-gray-600",
};

const MAP_COLOR: Record<ViewStatus, string> = {
  working: "#34d399",
  warning: "#fbbf24",
  down: "#f87171",
  unknown: "#5b6b77",
  cant_check: "#5b6b77",
};

const SLOT: Record<TimelineSlot, string> = {
  working: "bg-emerald-400/60",
  warning: "bg-amber-400",
  down: "bg-red-400",
  no_data: "bg-white/[0.06]",
};

const BANNER_TONE: Record<Banner["tone"], { box: string; dot: ViewStatus }> = {
  ok: { box: "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-100", dot: "working" },
  warn: { box: "border-amber-400/40 bg-amber-400/10 text-amber-100", dot: "warning" },
  down: { box: "border-red-400/45 bg-red-400/[0.12] text-red-100", dot: "down" },
  loading: { box: "border-white/10 bg-white/[0.03] text-gray-400", dot: "unknown" },
};

function Dot({ status }: { status: ViewStatus }) {
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[status]}`} />;
}

function StatusBanner({ banner, onClick }: { banner: Banner; onClick?: () => void }) {
  const tone = BANNER_TONE[banner.tone];
  const content = (
    <>
      <Dot status={tone.dot} />
      <span className="min-w-0 flex-1">
        {banner.headline && <b className="font-semibold">{banner.headline} </b>}
        {banner.body}
      </span>
      {onClick && <span className="shrink-0 font-semibold">Health →</span>}
    </>
  );
  const className = `flex w-full items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-left text-sm ${tone.box}`;
  return onClick ? (
    <button onClick={onClick} className={`${className} transition-colors hover:border-red-400`}>{content}</button>
  ) : (
    <div className={className} role="status">{content}</div>
  );
}

function PageHeader({ title, onRefresh }: { title: string; onRefresh: () => Promise<void> | void }) {
  const [refreshing, setRefreshing] = useState(false);
  async function refreshNow() {
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  }
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        <p className="mt-1 text-sm text-gray-500">Everything the shop depends on, checked every 10 minutes with its real keys.</p>
      </div>
      <button
        onClick={refreshNow}
        disabled={refreshing}
        className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:border-cyan-400/50 disabled:opacity-60"
      >
        {refreshing ? "Loading..." : "Refresh"}
      </button>
    </div>
  );
}

// ─── Banner on every other admin page while something is down ───────────────

export function HealthDownBanner({ model, onOpen }: { model: HealthViewModel; onOpen: () => void }) {
  if (model.banner.tone !== "down") return null;
  return (
    <div className="mb-6">
      <StatusBanner banner={model.banner} onClick={onOpen} />
    </div>
  );
}

// ─── Health: everything in one list (option A) ──────────────────────────────

function Strip({ slots }: { slots: TimelineSlot[] }) {
  if (!slots.length) return null;
  return (
    <div className="mt-1.5 flex gap-px" aria-label="Last 7 days">
      {slots.map((slot, index) => (
        <i key={index} className={`block h-2 min-w-0 flex-1 rounded-[1px] ${SLOT[slot]}`} />
      ))}
    </div>
  );
}

function DependencyRow({ row }: { row: HealthRow }) {
  const tone =
    row.status === "down"
      ? "bg-red-400/10 outline outline-1 outline-red-400/35"
      : row.status === "warning"
        ? "bg-white/[0.03] outline outline-1 outline-amber-400/30"
        : "bg-white/[0.03]";
  return (
    <div className={`grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2.5 ${tone}`}>
      <Dot status={row.status} />
      <div className="min-w-0">
        <div className="text-sm font-semibold text-white">{row.name}</div>
        <div className="text-xs text-gray-500">{row.subtitle}</div>
        <div className="max-w-md"><Strip slots={row.timelineSlots} /></div>
      </div>
      <div className="max-w-[45vw] text-right text-xs text-gray-400 sm:max-w-[16rem]">
        <div className={`truncate ${row.status === "down" ? "font-semibold text-red-300" : row.status === "warning" ? "font-semibold text-amber-200" : "text-gray-200"}`}>{row.primary}</div>
        {row.secondary && <div className="truncate">{row.secondary}</div>}
      </div>
    </div>
  );
}

const pacificTime = (instantIso: string) =>
  new Date(instantIso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function HealthListView({ model, report, error, onRefresh }: {
  model: HealthViewModel;
  report: HealthReport | null;
  error: string | null;
  onRefresh: () => Promise<void> | void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Health" onRefresh={onRefresh} />
      <StatusBanner banner={model.banner} />
      {error && <p className="text-sm text-red-400">Couldn't load: {error}</p>}

      {rowsByGroup(model.rows).map(({ group, rows }) => (
        <section key={group}>
          <h2 className="mb-2 mt-2 text-[10px] uppercase tracking-[0.14em] text-gray-500">{group}</h2>
          <div className="flex flex-col gap-1.5">
            {rows.map((row) => <DependencyRow key={row.key} row={row} />)}
          </div>
        </section>
      ))}

      {model.secrets.length > 0 && (
        <section>
          <h2 className="mb-2 mt-2 text-[10px] uppercase tracking-[0.14em] text-gray-500">Secrets present</h2>
          <div className="flex flex-wrap gap-1.5">
            {model.secrets.map((secret) => (
              <span
                key={secret.label}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${secret.present ? "border-white/10 bg-white/[0.03] text-gray-200" : "border-red-400/60 text-red-200"}`}
              >
                <Dot status={secret.present ? "working" : "down"} />
                {secret.label}
                {!secret.present ? " missing" : secret.note ? ` (${secret.note})` : ""}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">Only checks that each secret is set. Values never leave the server.</p>
        </section>
      )}

      {report && !model.apiDown && report.incidentsNewestFirst.length > 0 && (
        <section className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">Incidents, last {report.windowDays} days</h2>
          <ul>
            {report.incidentsNewestFirst.map((incident) => (
              <li key={`${incident.service}-${incident.startedAtIso}`} className="flex flex-wrap justify-between gap-x-4 border-t border-white/5 py-2 text-sm first:border-t-0">
                <span className="text-white">
                  {incident.displayName}: {incident.failureSummary}. {incident.endedAtIso === null ? `Ongoing for ${incident.durationText}.` : `Down for ${incident.durationText}.`}
                </span>
                <span className={`tabular-nums ${incident.endedAtIso === null ? "text-red-400" : "text-gray-500"}`}>{pacificTime(incident.startedAtIso)} PT</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-gray-500">
        The team gets an email when something goes down and another when it is fixed, nothing in between and never an "all good".
        Running low shows here only; a limit that actually runs out counts as down. Running out of credit or a rejected key counts on the
        first failed check; outages wait for a second check so a blip doesn't page anyone. A separate check on Vercel watches the Railway
        API, so a Railway outage still gets noticed.
      </p>
    </div>
  );
}

// ─── Map: what customers use (option B) ──────────────────────────────────────

function DependencyMap({ model }: { model: HealthViewModel }) {
  const statusByKey = new Map(model.rows.map((row) => [row.key, row.status]));
  const { width, height, boxHeight } = MAP_VIEWBOX;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Map of what the shop depends on">
      {mapLines(model.rows).map((line) => {
        const childStatus = statusByKey.get(line.key);
        const stroke = model.apiDown || childStatus === "down" ? "#7f2d2d" : "#1a4a5a";
        return <line key={line.key} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={stroke} strokeWidth={1.6} />;
      })}
      {model.rows.map((row) => {
        const color = MAP_COLOR[row.status];
        const { x, y, width: boxWidth, label, sub } = row.map;
        return (
          <g key={row.key}>
            <title>{`${row.name}: ${row.subtitle}`}</title>
            <rect x={x} y={y} width={boxWidth} height={boxHeight} rx={7} fill="#0d1a24" stroke={color} strokeWidth={1.6} />
            <circle cx={x + 12} cy={y + 13} r={4} fill={color} />
            <text x={x + 22} y={y + 17} fill="#f0f0f0" fontSize={11} fontWeight={700}>{label}</text>
            <text x={x + 10} y={y + 31} fill="#8a9aa6" fontSize={9.5}>{row.status === "cant_check" ? "can't check" : sub}</text>
          </g>
        );
      })}
    </svg>
  );
}

const OUTCOME_COLOR: Record<ViewStatus, string> = {
  working: "text-emerald-400",
  warning: "text-amber-400",
  down: "text-red-400",
  unknown: "text-gray-500",
  cant_check: "text-gray-500",
};

const LEGEND: { status: ViewStatus; label: string }[] = [
  { status: "working", label: "working" },
  { status: "warning", label: "running low" },
  { status: "down", label: "down" },
  { status: "cant_check", label: "can't check" },
];

export function HealthMapView({ model, error, onRefresh }: { model: HealthViewModel; error: string | null; onRefresh: () => Promise<void> | void }) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Map" onRefresh={onRefresh} />
      <StatusBanner banner={model.banner} />
      {error && <p className="text-sm text-red-400">Couldn't load: {error}</p>}
      <section className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
        <div className="mx-auto max-w-2xl"><DependencyMap model={model} /></div>
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-gray-500">
          {LEGEND.map((entry) => (
            <span key={entry.status} className="inline-flex items-center gap-1.5">
              <Dot status={entry.status} />
              {entry.label}
            </span>
          ))}
        </div>
      </section>
      <section className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
        <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">For customers and Tommy right now</h2>
        {model.outcomes.map((outcome) => (
          <div key={outcome.label} className="flex justify-between gap-4 border-t border-white/5 py-1.5 text-sm first:border-t-0">
            <span className="text-white">{outcome.label}</span>
            <span className={OUTCOME_COLOR[outcome.status]}>{outcome.statusText}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
