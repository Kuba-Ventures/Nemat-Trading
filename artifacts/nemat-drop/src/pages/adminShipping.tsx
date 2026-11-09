import { useState } from "react";

// Shipping view for the admin Orders page (option C): status tiles that filter
// the list, an alert for late orders, a status pill and tracking per row, and a
// timeline (ordered, label printed, shipped, delivered) in the expanded row.

export type ShipStage = "to_ship" | "label" | "transit" | "delivered" | "problem" | "untracked";

export type ShippingInfo = {
  stage: ShipStage;
  days: number;
  late: boolean;
  carrier: "UPS" | "USPS" | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: string | null;
  statusDetail: string | null;
  location: string | null;
  labelCreatedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  checkedAt: string | null;
  emailedAt: string | null;
};

export type ShipFilter = "all" | "to_ship" | "transit" | "delivered" | "attention";

type Shippable = { shipping: ShippingInfo };

export function matchesFilter(s: ShippingInfo, f: ShipFilter): boolean {
  switch (f) {
    case "all":
      return true;
    case "to_ship":
      return s.stage === "to_ship";
    case "transit":
      return s.stage === "label" || s.stage === "transit";
    case "delivered":
      return s.stage === "delivered" || s.stage === "untracked";
    case "attention":
      return s.late;
  }
}

export function countFilters(orders: Shippable[]): Record<ShipFilter, number> {
  const keys: ShipFilter[] = ["all", "to_ship", "transit", "delivered", "attention"];
  return Object.fromEntries(keys.map((k) => [k, orders.filter((o) => matchesFilter(o.shipping, k)).length])) as Record<ShipFilter, number>;
}

/** "9400 1118 …4412": enough to recognise a number without the full width. */
export function shortTracking(n: string): string {
  if (n.length <= 12) return n;
  return `${n.slice(0, 4)} ${n.slice(4, 8)} …${n.slice(-4)}`;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const PILL: Record<ShipStage, { text: string; cls: string }> = {
  to_ship: { text: "Not shipped", cls: "text-gray-300 bg-white/[0.06]" },
  label: { text: "Label printed", cls: "text-sky-300 bg-sky-400/10" },
  transit: { text: "In transit", cls: "text-sky-300 bg-sky-400/10" },
  delivered: { text: "Delivered", cls: "text-green-400 bg-green-400/10" },
  problem: { text: "Problem", cls: "text-red-400 bg-red-400/10" },
  untracked: { text: "Shipped, no tracking", cls: "text-gray-400 bg-white/[0.04]" },
};

export function StagePill({ s }: { s: ShippingInfo }) {
  const p = PILL[s.stage];
  const lateCls = s.late && s.stage !== "problem" ? "text-amber-300 bg-amber-400/10" : p.cls;
  const suffix = s.late && (s.stage === "to_ship" || s.stage === "label" || s.stage === "transit") ? ` · ${s.days}d` : "";
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${lateCls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {p.text}
      {suffix}
    </span>
  );
}

export function TrackingCell({ s }: { s: ShippingInfo }) {
  if (!s.trackingNumber) return <span className="text-xs text-gray-600">{s.stage === "untracked" ? "No number kept" : "No tracking yet"}</span>;
  const sub = s.stage === "delivered" && s.deliveredAt
    ? `Delivered ${fmtDate(s.deliveredAt)}`
    : [s.location, s.checkedAt ? fmtDate(s.checkedAt) : null].filter(Boolean).join(" · ");
  return (
    <span className="min-w-0">
      <a
        href={s.trackingUrl ?? "#"}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="font-mono text-xs text-cyan-400 hover:text-cyan-300"
        title={s.trackingNumber}
      >
        {s.carrier} {shortTracking(s.trackingNumber)}
      </a>
      {sub && <div className="truncate text-[11px] text-gray-500">{sub}</div>}
    </span>
  );
}

const TILES: { key: ShipFilter; label: string; warn?: boolean }[] = [
  { key: "all", label: "All" },
  { key: "to_ship", label: "To ship", warn: true },
  { key: "transit", label: "In transit" },
  { key: "delivered", label: "Delivered" },
  { key: "attention", label: "Needs attention", warn: true },
];

export function ShippingSummary<T extends Shippable & { name: string | null; email: string }>({
  orders,
  filter,
  onFilter,
}: {
  orders: T[];
  filter: ShipFilter;
  onFilter: (f: ShipFilter) => void;
}) {
  const counts = countFilters(orders);
  const late = orders.filter((o) => o.shipping.late);
  const who = (o: T) => o.name?.trim() || o.email;
  const lateLine = late
    .slice(0, 3)
    .map((o) =>
      o.shipping.stage === "problem"
        ? `${who(o)}'s package has a problem (${o.shipping.statusDetail ?? o.shipping.status ?? "check tracking"})`
        : o.shipping.stage === "to_ship"
          ? `${who(o)} has waited ${plural(o.shipping.days, "day")} with no tracking`
          : o.shipping.stage === "label"
            ? `${who(o)}'s label was printed ${plural(o.shipping.days, "day")} ago and hasn't been scanned`
            : `${who(o)}'s package has been in transit ${plural(o.shipping.days, "day")}`,
    )
    .join("; ");

  return (
    <div className="mb-5">
      <div className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-5" role="group" aria-label="Filter by shipping status">
        {TILES.map((t) => {
          const on = filter === t.key;
          const warn = t.warn && counts[t.key] > 0;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onFilter(t.key)}
              aria-pressed={on}
              className={`rounded border px-3.5 py-3 text-left transition-colors ${on ? "border-cyan-400/50 bg-cyan-400/[0.05]" : "border-white/[0.07] bg-white/[0.01] hover:border-white/20"}`}
            >
              <div className={`text-2xl font-bold tabular-nums ${warn ? "text-amber-300" : "text-white"}`}>{counts[t.key]}</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">{t.label}</div>
            </button>
          );
        })}
      </div>
      {late.length > 0 && (
        <div className="rounded border border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-[13px] text-amber-100">
          {plural(late.length, "order")} {late.length === 1 ? "needs" : "need"} you: {lateLine}
          {late.length > 3 ? `, and ${late.length - 3} more` : ""}.
        </div>
      )}
    </div>
  );
}

function Step({ on, label, when, note }: { on: boolean; label: string; when: string | null; note?: string | null }) {
  return (
    <li className="flex gap-2.5 text-xs">
      <span className={`mt-[5px] h-2 w-2 flex-none rounded-full ${on ? "bg-cyan-400" : "bg-gray-700"}`} />
      <span className={on ? "text-gray-200" : "text-gray-600"}>
        {label}
        {when && <span className="text-gray-500"> · {fmtDateTime(when)}</span>}
        {note && <div className="text-[11px] text-gray-500">{note}</div>}
      </span>
    </li>
  );
}

export function ShippingDetail({
  orderDate,
  shipTo,
  s,
  onSaveTracking,
  onMarkUntracked,
  onEmailTracking,
}: {
  orderDate: string;
  shipTo: string | null;
  s: ShippingInfo;
  onSaveTracking: (tracking: string, emailCustomer: boolean) => Promise<string | null>;
  onMarkUntracked: () => Promise<string | null>;
  onEmailTracking: () => Promise<string | null>;
}) {
  const [tracking, setTracking] = useState("");
  const [emailCustomer, setEmailCustomer] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<string | null>) {
    setBusy(true);
    setMsg(null);
    setMsg(await fn());
    setBusy(false);
  }

  const delivered = s.stage === "delivered";
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-gray-600">Timeline</div>
        <ul className="flex flex-col gap-2">
          <Step on label="Ordered" when={orderDate} />
          <Step on={!!s.labelCreatedAt || !!s.trackingNumber || s.stage === "untracked"} label="Label printed" when={s.labelCreatedAt} />
          <Step on={!!s.shippedAt || s.stage === "untracked"} label="Shipped (first carrier scan)" when={s.shippedAt} />
          <Step
            on={delivered}
            label={s.stage === "problem" ? "Problem" : "Delivered"}
            when={s.deliveredAt}
            note={s.stage === "problem" || delivered ? s.statusDetail : null}
          />
        </ul>
        {shipTo && (
          <div className="mt-4 text-xs">
            <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-gray-600">Ship to</div>
            <div className="text-gray-300">{shipTo}</div>
            {s.location && <div className="mt-1 text-gray-500">Last seen: {s.location}</div>}
          </div>
        )}
      </div>

      <div>
        {!s.trackingNumber && s.stage !== "untracked" ? (
          <>
            <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-gray-600">Add tracking</div>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (tracking.trim()) run(() => onSaveTracking(tracking.trim(), emailCustomer));
              }}
            >
              <input
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
                placeholder="Paste a USPS or UPS number"
                aria-label="Tracking number"
                className="min-w-[180px] flex-1 rounded border border-white/10 bg-black/40 px-3 py-2 font-mono text-[13px] text-white placeholder:text-gray-600 focus:border-cyan-400/50 focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy || !tracking.trim()}
                className="rounded bg-cyan-400 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.15em] text-black hover:bg-cyan-300 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </form>
            <label className="mt-2 flex items-center gap-2 text-xs text-gray-400">
              <input type="checkbox" checked={emailCustomer} onChange={(e) => setEmailCustomer(e.target.checked)} />
              Email the customer their tracking
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(onMarkUntracked)}
              className="mt-3 text-[11px] text-gray-500 underline-offset-2 hover:text-gray-300 hover:underline disabled:opacity-50"
            >
              Mark shipped without tracking
            </button>
          </>
        ) : (
          <>
            <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-gray-600">Customer email</div>
            {s.emailedAt ? (
              <div className="text-xs text-gray-400">Tracking emailed {fmtDateTime(s.emailedAt)}</div>
            ) : s.trackingNumber ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(onEmailTracking)}
                className="rounded border border-cyan-400/30 px-3 py-1.5 text-[11px] text-cyan-400 hover:border-cyan-400/60 disabled:opacity-50"
              >
                {busy ? "Sending…" : "Email tracking to customer"}
              </button>
            ) : (
              <div className="text-xs text-gray-500">No tracking to send.</div>
            )}
          </>
        )}
        {msg && <div className="mt-2 text-xs text-gray-400">{msg}</div>}
      </div>
    </div>
  );
}
