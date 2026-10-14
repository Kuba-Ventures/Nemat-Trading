import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BrandIcon, type BrandKey } from "@/components/BrandIcon";
import { SYNC_POLL_MS, syncStatus, type SyncSource } from "@/lib/syncStatus";

// Finance and Growth dashboards for /admin, fed by GET /api/admin/metrics.
// Layout is the "one-page scorecard" (Option A) chosen on 2026-10-13, split
// into a finance page and a marketing page. Each card handles its own source
// failing, so a Stripe or Meta outage never blanks the whole page.

// ─── Types (mirror artifacts/api-server/src/lib/metrics.ts) ──────────────────

type Source = "Meta" | "Thank-you card" | "Google" | "Other" | "Direct";

type Finance = {
  grossCents: number;
  discountCents: number;
  refundCents: number;
  netCents: number;
  orders: number;
  avgOrderCents: number | null;
  feeCents: number;
  postageCents: number;
  repeatBuyers: number;
  daily: { date: string; revenueCents: number }[];
  sources: { source: Source; orders: number; revenueCents: number }[];
  recent: { ref: string; date: string; totalCents: number; discountCents: number; label: "bought" | "shipped" | "none"; source: Source }[];
};

type Meta = {
  spendCents: number;
  daily: { date: string; spendCents: number }[];
  campaigns: {
    id: string;
    name: string;
    status: string;
    state: "active" | "ended" | "paused" | "other";
    statusLabel: string;
    endsAt: string | null;
    spendCents: number;
    ctr: number | null;
    purchases: number;
  }[];
};

type Ga4 = {
  sessions: number;
  steps: { label: string; sessions: number; pctOfPrevious: number | null }[];
  conversion: number | null;
  daily: { date: string; sessions: number }[];
};

type Block<T> = ({ ok: true } & T) | { ok: false; error: string };

export type Metrics = {
  range: { key: string; start: string | null; end: string };
  days: string[];
  generatedAt: string;
  // When each source was last fetched (null: not configured or it failed).
  synced?: Partial<Record<SyncSource, string | null>>;
  finance: Block<Finance>;
  meta: Block<Meta> | null;
  ga4: Block<Ga4> | null;
};

export type MetricsLoader = (range: string, opts?: { fresh?: boolean }) => Promise<Metrics>;

// ─── Config ───────────────────────────────────────────────────────────────────

// Validated for the dark surface (dataviz check, 2026-10-13): CVD and contrast pass.
const COLOR = { revenue: "#1497ad", spend: "#b58424" };

export const ACCOUNT_LINKS: { label: string; href: string; brand: BrandKey }[] = [
  { label: "Stripe", href: "https://dashboard.stripe.com/acct_1TJwECDFbDz5vOgM/dashboard", brand: "stripe" },
  { label: "Meta Ads Manager", href: "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=987622110989837&business_id=2000673880800829", brand: "meta" },
  // GA4 property 541136891 (account 340998971), confirmed 2026-10-13.
  { label: "GA4", href: "https://analytics.google.com/analytics/web/#/a340998971p541136891/reports/intelligenthome", brand: "googleanalytics" },
  // GTM-TVHXMXW5.
  { label: "Tag Manager", href: "https://tagmanager.google.com/#/container/accounts/6353614712/containers/257567057", brand: "googletagmanager" },
  { label: "Search Console", href: "https://search.google.com/search-console?resource_id=sc-domain%3Atommytopdecker.com", brand: "googlesearchconsole" },
  // Tommy Top Decker's Facebook Page (page id 1265007950025605).
  { label: "Facebook", href: "https://www.facebook.com/61591387427539", brand: "facebook" },
  { label: "Shippo", href: "https://apps.goshippo.com/shipments", brand: "shippo" },
  { label: "Railway", href: "https://railway.com/project/6898fb14-7379-4f0b-9924-2b41fd04b78d", brand: "railway" },
  { label: "Vercel", href: "https://vercel.com/kuba-ventures/tommytopdecker-trading-co", brand: "vercel" },
];

const RANGES = [
  { key: "7d", label: "7d" },
  { key: "14d", label: "14d" },
  { key: "30d", label: "30d" },
  { key: "all", label: "All" },
];

// ─── Formatting ───────────────────────────────────────────────────────────────

const money = (cents: number | null | undefined, digits = 2) =>
  cents == null
    ? "-"
    : `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

const shortDay = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const ratio = (num: number, den: number | null | undefined) => (den ? num / den : null);

// "Shipped": went out without a Shippo label (e.g. from the client's house).
const LABEL_TEXT: Record<string, string> = { bought: "Bought", shipped: "Shipped", none: "Not yet" };

const STATUS_DOT: Record<Meta["campaigns"][number]["state"], string> = {
  active: "bg-emerald-500",
  paused: "bg-amber-500",
  ended: "bg-gray-500",
  other: "bg-gray-500",
};

// ─── Data hook ────────────────────────────────────────────────────────────────

function useMetrics(load: MetricsLoader, range: string) {
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); // first load or a range change
  const [syncing, setSyncing] = useState(false); // background or forced sync
  const [, tick] = useState(0);
  const seq = useRef(0);

  const fetchMetrics = useCallback(
    (mode: "range" | "poll" | "force") => {
      const id = ++seq.current;
      if (mode === "range") setLoading(true);
      else setSyncing(true);
      return load(range, mode === "force" ? { fresh: true } : undefined)
        .then((m) => { if (id === seq.current) { setData(m); setError(null); } })
        .catch((err) => { if (id === seq.current) setError(err?.message ?? "Couldn't load metrics"); })
        .finally(() => { if (id === seq.current) { setLoading(false); setSyncing(false); } });
    },
    [load, range],
  );

  useEffect(() => {
    fetchMetrics("range");
    // Live view: sync every minute while the tab is visible, and as soon as it
    // comes back into view. The 15s tick re-evaluates the stale state.
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") fetchMetrics("poll");
    }, SYNC_POLL_MS);
    const ticker = window.setInterval(() => tick((n) => n + 1), 15_000);
    const onVisible = () => { if (document.visibilityState === "visible") fetchMetrics("poll"); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      seq.current++;
      window.clearInterval(poll);
      window.clearInterval(ticker);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchMetrics]);

  const syncNow = useCallback(() => { fetchMetrics("force"); }, [fetchMetrics]);
  return { data, error, loading, syncing, syncNow };
}

// ─── Building blocks ──────────────────────────────────────────────────────────

function Card({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-lg border border-white/10 bg-white/[0.03] p-4 ${className}`}>
      {title && <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">{title}</h2>}
      {children}
    </section>
  );
}

function Tile({ label, value, note, muted }: { label: string; value: string; note?: string; muted?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.15em] text-gray-400">{label}</div>
      <div className={`mt-1 truncate text-2xl font-bold tabular-nums ${muted ? "text-gray-500" : "text-white"}`}>{value}</div>
      {note && <div className="mt-0.5 truncate text-xs text-gray-500">{note}</div>}
    </div>
  );
}

function CardError({ message }: { message: string }) {
  return <p className="text-sm text-red-400">Couldn't load: {message}</p>;
}

const SYNC_DOT = { live: "bg-emerald-400", stale: "bg-amber-400", error: "bg-red-400" } as const;

function SyncPill({ data, requestFailed, syncing, onSync }: {
  data: Metrics | null;
  requestFailed: boolean;
  syncing: boolean;
  onSync: () => void;
}) {
  if (!data) return null;
  const failed = (["stripe", "meta", "ga4"] as const).filter((s) => {
    const b = s === "stripe" ? data.finance : data[s];
    return b != null && !b.ok;
  });
  const status = syncStatus({ synced: data.synced ?? { stripe: data.generatedAt }, failed: [...failed], requestFailed }, Date.now());
  const dot = SYNC_DOT[status.state];
  return (
    <>
      <span
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-gray-300"
        title={status.detail}
        role="status"
      >
        <span className="relative flex h-2 w-2">
          {status.state === "live" && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${dot}`} />}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${dot}`} />
        </span>
        {syncing ? "Syncing..." : status.label}
      </span>
      <button
        onClick={onSync}
        disabled={syncing}
        className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:border-cyan-400/50 disabled:opacity-60"
      >
        <svg className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
          <path d="M21 3v5h-5" />
        </svg>
        Sync
      </button>
    </>
  );
}

function Header({ title, range, onRange, sync }: {
  title: string;
  range: string;
  onRange: (r: string) => void;
  sync: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        <p className="text-xs text-gray-500">Test orders excluded.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {sync}
        <div className="flex gap-1 rounded-md border border-white/10 bg-white/[0.03] p-1" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => onRange(r.key)}
              aria-pressed={range === r.key}
              className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                range === r.key ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AccountLinks() {
  return (
    <div className="flex flex-wrap gap-2">
      {ACCOUNT_LINKS.map((l) => (
        <a
          key={l.label}
          href={l.href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white transition-colors hover:border-cyan-400/50"
        >
          <BrandIcon brand={l.brand} />
          {l.label} <span className="text-gray-500">↗</span>
        </a>
      ))}
    </div>
  );
}

// ─── Bar chart ────────────────────────────────────────────────────────────────

type Series = { name: string; color: string; values: number[] };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/** Grouped daily bars (cents). One series: no legend; two: legend above. Hover shows the day. */
function DailyBars({ days, series, height = 180 }: { days: string[]; series: Series[]; height?: number }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ i: number; x: number } | null>(null);
  const [asTable, setAsTable] = useState(false);

  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const left = 44;
  const plotH = height - 24;
  const slot = (width - left) / Math.max(1, days.length);
  const barW = Math.max(2, Math.min(12, (slot - 4 - 2 * (series.length - 1)) / series.length));
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor((width - left) / 70))));
  const y = (v: number) => 6 + plotH - (plotH - 6) * (v / max);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        {series.length > 1 ? (
          <div className="flex flex-wrap gap-4 text-xs text-gray-400">
            {series.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1.5">
                <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                {s.name}
              </span>
            ))}
          </div>
        ) : <span />}
        <button onClick={() => setAsTable((t) => !t)} className="text-[11px] uppercase tracking-[0.12em] text-gray-500 hover:text-white">
          {asTable ? "Chart" : "Table"}
        </button>
      </div>

      {asTable ? (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-gray-500">
                <th className="py-1.5 font-medium">Day</th>
                {series.map((s) => <th key={s.name} className="py-1.5 text-right font-medium">{s.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {days.map((d, i) => (
                <tr key={d} className="border-t border-white/5">
                  <td className="py-1.5 text-gray-300">{shortDay(d)}</td>
                  {series.map((s) => <td key={s.name} className="py-1.5 text-right tabular-nums text-white">{money(s.values[i])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
          <svg width={width} height={height} role="img" aria-label={`${series.map((s) => s.name).join(" and ")} by day`}>
            {[0, 0.5, 1].map((g) => (
              <g key={g}>
                <line x1={left} x2={width} y1={y(max * g)} y2={y(max * g)} stroke="rgba(255,255,255,0.07)" />
                <text x={left - 6} y={y(max * g) + 4} textAnchor="end" className="fill-gray-500 text-[10px]">{money(max * g, 0)}</text>
              </g>
            ))}
            {days.map((d, i) => {
              const groupW = barW * series.length + 2 * (series.length - 1);
              const x0 = left + i * slot + (slot - groupW) / 2;
              return (
                <g key={d}>
                  {series.map((s, j) => {
                    const v = s.values[i] ?? 0;
                    if (v <= 0) return null;
                    const top = y(v), base = y(0), x = x0 + j * (barW + 2), r = Math.min(4, barW / 2, base - top);
                    // Rounded top corners only; the bar sits square on the baseline.
                    return (
                      <path key={s.name} fill={s.color} opacity={hover && hover.i !== i ? 0.45 : 1}
                        d={`M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + barW - r}Q${x + barW},${top} ${x + barW},${top + r}V${base}Z`} />
                    );
                  })}
                  {i % labelEvery === 0 && (
                    <text x={left + i * slot + slot / 2} y={height - 4} textAnchor="middle" className="fill-gray-500 text-[10px]">{shortDay(d)}</text>
                  )}
                  <rect x={left + i * slot} y={0} width={slot} height={plotH + 6} fill="transparent"
                    onMouseEnter={() => setHover({ i, x: left + i * slot + slot / 2 })} />
                </g>
              );
            })}
          </svg>
          {hover && (
            <div className="pointer-events-none absolute top-0 z-10 rounded-md border border-white/10 bg-[#1f1f25] px-2.5 py-1.5 text-xs shadow-lg"
              style={{ left: Math.min(Math.max(hover.x - 70, 0), width - 150), width: 140 }}>
              <div className="font-semibold text-white">{shortDay(days[hover.i])}</div>
              {series.map((s) => (
                <div key={s.name} className="flex items-center justify-between gap-2 text-gray-300">
                  <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.name}</span>
                  <span className="tabular-nums text-white">{money(s.values[hover.i])}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RecentOrders({ rows }: { rows: Finance["recent"] }) {
  if (!rows.length) return <p className="text-sm text-gray-500">No orders in this range.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-gray-500">
            <th className="py-1.5 font-medium">Order</th>
            <th className="py-1.5 font-medium">Date</th>
            <th className="py-1.5 text-right font-medium">Total</th>
            <th className="py-1.5 text-right font-medium">Discount</th>
            <th className="py-1.5 pl-3 font-medium">Label</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ref} className="border-t border-white/5">
              <td className="py-2 font-mono text-xs text-white">#{r.ref}</td>
              <td className="py-2 text-gray-300">{new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
              <td className="py-2 text-right tabular-nums text-white">{money(r.totalCents)}</td>
              <td className="py-2 text-right tabular-nums text-gray-300">{r.discountCents ? `-${money(r.discountCents)}` : "-"}</td>
              <td className="py-2 pl-3 text-gray-300">{LABEL_TEXT[r.label] ?? "Not yet"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Shell({ title, load, children }: {
  title: string;
  load: MetricsLoader;
  children: (m: Metrics) => React.ReactNode;
}) {
  const [range, setRange] = useState("30d");
  const { data, error, loading, syncing, syncNow } = useMetrics(load, range);
  return (
    <div>
      <Header
        title={title}
        range={range}
        onRange={setRange}
        sync={<SyncPill data={data} requestFailed={!!error && !!data} syncing={syncing} onSync={syncNow} />}
      />
      {error && !data && <p className="text-sm text-red-400">Couldn't load metrics: {error}</p>}
      {loading && !data && <p className="text-sm text-gray-500">Loading...</p>}
      {data && <div className={loading ? "opacity-60 transition-opacity" : ""}>{children(data)}</div>}
    </div>
  );
}

// ─── Finance ──────────────────────────────────────────────────────────────────

export function FinanceDashboard({ load }: { load: MetricsLoader }) {
  return (
    <Shell title="Finance" load={load}>
      {(m) => {
        const f = m.finance;
        const spend = m.meta && m.meta.ok ? m.meta.spendCents : null;
        if (!f.ok) return <Card><CardError message={f.error} /></Card>;
        const estNet = f.netCents - f.feeCents - f.postageCents - (spend ?? 0);
        const per = (c: number) => (f.grossCents ? `$${(c / f.grossCents).toFixed(2)}` : "-");
        const kept = f.grossCents - f.discountCents - f.refundCents - f.feeCents - f.postageCents - (spend ?? 0);
        return (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label="Gross revenue" value={money(f.grossCents)} note="before discounts and refunds" />
              <Tile label="Net revenue" value={money(f.netCents)} note={`-${money(f.discountCents)} discounts, -${money(f.refundCents)} refunds`} />
              <Tile label="Orders" value={String(f.orders)} />
              <Tile label="Avg order" value={money(f.avgOrderCents)} />
              <Tile label="Stripe fees" value={money(f.feeCents)} />
              <Tile label="Postage" value={money(f.postageCents)} note="labels bought in Shippo" />
              <Tile label="Refunds" value={money(f.refundCents)} />
              <Tile label="Est. net" value={money(estNet)} note={spend == null ? "ad spend not included (Meta not connected)" : "after fees, postage and ads"} />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Card title="Net revenue by day" className="md:col-span-2">
                <DailyBars days={m.days} series={[{ name: "Revenue", color: COLOR.revenue, values: f.daily.map((d) => d.revenueCents) }]} />
              </Card>
              <Card title="Where each $1 goes">
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      ["Discounts", f.discountCents],
                      ["Refunds", f.refundCents],
                      ["Stripe fees", f.feeCents],
                      ["Postage", f.postageCents],
                      ["Ad spend", spend],
                    ].map(([label, c]) => (
                      <tr key={label as string} className="border-t border-white/5 first:border-0">
                        <td className="py-2 text-gray-300">{label}</td>
                        <td className="py-2 text-right tabular-nums text-white">{c == null ? "Not connected" : per(c as number)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-white/10">
                      <td className="py-2 font-semibold text-white">Kept, before product cost</td>
                      <td className="py-2 text-right font-semibold tabular-nums text-white">{per(kept)}</td>
                    </tr>
                  </tbody>
                </table>
              </Card>
            </div>
            <Card title="Recent orders"><RecentOrders rows={f.recent} /></Card>
          </div>
        );
      }}
    </Shell>
  );
}

// ─── Growth ───────────────────────────────────────────────────────────────────

function VisitorFunnel({ ga4 }: { ga4: Block<Ga4> | null }) {
  if (ga4 == null) {
    return (
      <div>
        <p className="text-sm text-gray-300">Connect GA4 to see where visitors drop off:</p>
        <ul className="mt-2 space-y-1 text-sm text-gray-500">
          <li>Site visits</li>
          <li>Viewed the pack</li>
          <li>Started checkout</li>
          <li>Purchased</li>
        </ul>
        <p className="mt-3 text-xs text-gray-500">
          Needs GA4_SERVICE_ACCOUNT_JSON on the server (a service account with Viewer on GA4 property 541136891).
        </p>
      </div>
    );
  }
  if (!ga4.ok) return <CardError message={ga4.error} />;
  if (!ga4.sessions) return <p className="text-sm text-gray-500">No site visits recorded in this range.</p>;

  const top = ga4.steps[0]?.sessions || 1;
  return (
    <div>
      <ul className="space-y-3">
        {ga4.steps.map((s) => (
          <li key={s.label}>
            <div className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-3 text-sm">
              <span className="text-gray-300">{s.label}</span>
              <div className="h-5" role="img" aria-label={`${s.label}: ${s.sessions.toLocaleString()} sessions`}>
                <div
                  className="h-full rounded-r"
                  style={{ width: `${Math.max(1.5, (s.sessions / top) * 100)}%`, background: COLOR.revenue }}
                />
              </div>
              <span className="tabular-nums text-white">{s.sessions.toLocaleString()}</span>
            </div>
            {s.pctOfPrevious != null && (
              <p className="ml-[calc(7.5rem+0.75rem)] mt-0.5 text-[11px] text-gray-500">
                {s.pctOfPrevious < 10 ? s.pctOfPrevious.toFixed(1) : Math.round(s.pctOfPrevious)}% of previous step
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t border-white/5 pt-3 text-xs text-gray-400">
        Conversion {ga4.conversion == null ? "-" : `${ga4.conversion.toFixed(1)}%`} of sessions purchased. Sessions from GA4.
      </p>
    </div>
  );
}

// ─── Scorecard email ──────────────────────────────────────────────────────────

export type WeeklyEmail = { subject: string; html: string; recipients: string[] };
export type WeeklyEmailApi = {
  preview: () => Promise<WeeklyEmail>;
  sendTest: (to: string) => Promise<void>;
};

// The every-other-Friday scorecard email (api-server lib/weeklySnapshot.ts): who gets it,
// a preview of the latest one, and a test send to a team address.
function WeeklyEmailCard({ api }: { api: WeeklyEmailApi }) {
  const [email, setEmail] = useState<WeeklyEmail | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [to, setTo] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const preview = async () => {
    setBusy("preview");
    setNote(null);
    try {
      setEmail(await api.preview());
      setOpen(true);
    } catch (err: any) {
      setNote({ ok: false, text: err?.message ?? "Preview failed" });
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    setBusy("send");
    setNote(null);
    try {
      await api.sendTest(to.trim());
      setNote({ ok: true, text: `Test sent to ${to.trim()}` });
    } catch (err: any) {
      setNote({ ok: false, text: err?.message ?? "Send failed" });
    } finally {
      setBusy(null);
    }
  };

  const recipients = email?.recipients;
  return (
    <Card title="Scorecard email">
      <p className="text-sm text-gray-300">
        A scorecard of the last 2 weeks goes out every other Friday at 4 PM PT
        {recipients == null ? "." : recipients.length ? ` to ${recipients.join(", ")}.` : ", once recipients are set on the server (WEEKLY_SNAPSHOT_TO)."}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={open ? () => setOpen(false) : preview}
          disabled={busy != null}
          className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-white hover:bg-white/5 disabled:opacity-50"
        >
          {busy === "preview" ? "Loading..." : open ? "Hide preview" : "Preview"}
        </button>
        <input
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="you@qsbsrollover.com"
          className="w-56 rounded-md border border-white/15 bg-transparent px-3 py-1.5 text-sm text-white placeholder:text-gray-600"
        />
        <button
          type="button"
          onClick={send}
          disabled={busy != null || !to.trim()}
          className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-white hover:bg-white/5 disabled:opacity-50"
        >
          {busy === "send" ? "Sending..." : "Send test"}
        </button>
        {note && <span className={`text-sm ${note.ok ? "text-emerald-400" : "text-red-400"}`}>{note.text}</span>}
      </div>
      {open && email && (
        <div className="mt-3">
          <p className="mb-2 text-xs text-gray-500">Subject: {email.subject}</p>
          <iframe title="Scorecard email preview" srcDoc={email.html} className="h-[900px] w-full max-w-[640px] rounded-md bg-white" />
        </div>
      )}
    </Card>
  );
}

export function GrowthDashboard({ load, weekly }: { load: MetricsLoader; weekly?: WeeklyEmailApi }) {
  return (
    <Shell title="Growth" load={load}>
      {(m) => {
        const f = m.finance;
        const meta = m.meta;
        const spend = meta && meta.ok ? meta.spendCents : null;
        const revenue = f.ok ? f.netCents : null;
        const roas = revenue != null && spend != null ? ratio(revenue, spend) : null;
        const cps = f.ok && spend != null ? ratio(spend, f.orders) : null;
        const spendNote = meta == null ? "Connect Meta" : meta.ok ? "Meta" : "Meta unavailable";

        return (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              <Tile label="Revenue" value={f.ok ? money(f.netCents) : "-"} note={f.ok ? undefined : "Stripe unavailable"} />
              <Tile label="Orders" value={f.ok ? String(f.orders) : "-"} />
              <Tile label="Ad spend" value={spend == null ? "Not connected" : money(spend)} note={spendNote} muted={spend == null} />
              <Tile label="ROAS" value={roas == null ? "-" : `${roas.toFixed(2)}x`} note="revenue / ad spend" muted={roas == null} />
              <Tile label="Cost per sale" value={cps == null ? "-" : money(cps)} note="ad spend / orders" muted={cps == null} />
              <Tile label="Repeat buyers" value={f.ok ? String(f.repeatBuyers) : "-"} note="used a return code" />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <Card title="Revenue vs ad spend, by day" className="md:col-span-2">
                {f.ok ? (
                  <DailyBars
                    days={m.days}
                    series={[
                      { name: "Revenue", color: COLOR.revenue, values: f.daily.map((d) => d.revenueCents) },
                      ...(meta && meta.ok ? [{ name: "Ad spend", color: COLOR.spend, values: meta.daily.map((d) => d.spendCents) }] : []),
                    ]}
                  />
                ) : <CardError message={f.error} />}
                {meta == null && <p className="mt-2 text-xs text-gray-500">Ad spend appears here once Meta is connected.</p>}
              </Card>
              <Card title="Visitor funnel">
                <VisitorFunnel ga4={m.ga4} />
              </Card>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <Card title="Campaigns" className="md:col-span-2">
                {meta == null ? (
                  <div className="text-sm text-gray-400">
                    <p className="text-white">Connect Meta to see live campaigns, spend and cost per sale.</p>
                    <p className="mt-1 text-gray-500">Needs a read-only Marketing API token (ads_read) set on the server.</p>
                  </div>
                ) : !meta.ok ? (
                  <CardError message={meta.error} />
                ) : meta.campaigns.length === 0 ? (
                  <p className="text-sm text-gray-500">No active campaigns or spend in this range.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-gray-500">
                          <th className="py-1.5 font-medium">Campaign</th>
                          <th className="py-1.5 font-medium">Status</th>
                          <th className="py-1.5 text-right font-medium">Spend</th>
                          <th className="py-1.5 text-right font-medium">CTR</th>
                          <th className="py-1.5 text-right font-medium">Sales</th>
                          <th className="py-1.5 text-right font-medium">Cost / sale</th>
                        </tr>
                      </thead>
                      <tbody>
                        {meta.campaigns.map((c) => {
                          return (
                            <tr key={c.id} className="border-t border-white/5">
                              <td className="py-2 pr-3 text-white">{c.name}</td>
                              <td className="py-2">
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-gray-300">
                                  <i className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[c.state] ?? "bg-gray-500"}`} />
                                  {c.statusLabel}
                                </span>
                              </td>
                              <td className="py-2 text-right tabular-nums text-white">{money(c.spendCents)}</td>
                              <td className="py-2 text-right tabular-nums text-gray-300">{c.ctr == null ? "-" : `${c.ctr.toFixed(1)}%`}</td>
                              <td className="py-2 text-right tabular-nums text-gray-300">{c.purchases}</td>
                              <td className="py-2 text-right tabular-nums text-gray-300">{c.purchases ? money(c.spendCents / c.purchases) : "-"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <p className="mt-2 text-xs text-gray-500">Sales here are what Meta tracked, plus orders credited to the campaign by hand.</p>
                  </div>
                )}
              </Card>
              <Card title="Orders by source">
                {!f.ok ? <CardError message={f.error} /> : f.sources.length === 0 ? (
                  <p className="text-sm text-gray-500">No orders in this range.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {f.sources.map((s) => (
                        <tr key={s.source} className="border-t border-white/5 first:border-0">
                          <td className="py-2 text-gray-300">{s.source}</td>
                          <td className="py-2 text-right tabular-nums text-gray-300">{s.orders}</td>
                          <td className="py-2 text-right tabular-nums text-white">{money(s.revenueCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="mt-2 text-xs text-gray-500">From the ad click id and UTM tags saved with each order.</p>
              </Card>
            </div>

            {weekly && <WeeklyEmailCard api={weekly} />}

            <Card title="Accounts"><AccountLinks /></Card>
          </div>
        );
      }}
    </Shell>
  );
}
