// Fulfillment status for the admin shipping view. Pure functions, no DB or
// network, so they can be tested on their own.
//
// Carrier status comes from Shippo's tracking API (GET /tracks/{carrier}/{number}),
// which works for any USPS or UPS number, including labels bought in Pirate Ship.

export type CarrierStatus = "UNKNOWN" | "PRE_TRANSIT" | "TRANSIT" | "DELIVERED" | "RETURNED" | "FAILURE";

export type TrackUpdate = {
  status: CarrierStatus;
  statusDetail: string | null;
  location: string | null;
  /** First carrier scan: the package is actually moving. */
  shippedAt: Date | null;
  deliveredAt: Date | null;
};

const STATUSES: CarrierStatus[] = ["UNKNOWN", "PRE_TRANSIT", "TRANSIT", "DELIVERED", "RETURNED", "FAILURE"];

type ShippoLocation = { city?: string | null; state?: string | null } | null | undefined;
type ShippoEvent = { status?: string | null; status_details?: string | null; status_date?: string | null; location?: ShippoLocation };

function toStatus(s: unknown): CarrierStatus {
  return STATUSES.includes(s as CarrierStatus) ? (s as CarrierStatus) : "UNKNOWN";
}

function toDate(s: unknown): Date | null {
  if (typeof s !== "string" || !s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function place(l: ShippoLocation): string | null {
  const p = [l?.city, l?.state].filter((x) => typeof x === "string" && x.trim()).join(", ");
  return p || null;
}

/** Shippo's track object, reduced to what the admin shows. */
export function parseShippoTrack(json: unknown): TrackUpdate {
  const t = (json ?? {}) as { tracking_status?: ShippoEvent | null; tracking_history?: ShippoEvent[] | null };
  const current = t.tracking_status ?? {};
  const status = toStatus(current.status);
  const history = Array.isArray(t.tracking_history) ? t.tracking_history : [];

  // Shipped = the earliest event after the label was created (in transit or later).
  const moving = history
    .filter((e) => ["TRANSIT", "DELIVERED", "RETURNED", "FAILURE"].includes(toStatus(e.status)))
    .map((e) => toDate(e.status_date))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());
  const currentDate = toDate(current.status_date);
  const shippedAt = moving[0] ?? (status !== "UNKNOWN" && status !== "PRE_TRANSIT" ? currentDate : null);

  return {
    status,
    statusDetail: typeof current.status_details === "string" && current.status_details.trim() ? current.status_details.trim() : null,
    location: place(current.location),
    shippedAt,
    deliveredAt: status === "DELIVERED" ? currentDate : null,
  };
}

export type ShipStage = "to_ship" | "label" | "transit" | "delivered" | "problem" | "untracked";

export type ShipRow = {
  createdAt: Date;
  trackingNumber: string | null;
  shippedElsewhere: boolean;
  trackingStatus: string | null;
  labelCreatedAt: Date | null;
  shippedAt: Date | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** Not shipped (or label printed but never scanned) after this many days is late. */
export const LATE_TO_SHIP_DAYS = 3;
/** In transit for longer than this is late. */
export const LATE_IN_TRANSIT_DAYS = 7;

export function shipStage(r: ShipRow): ShipStage {
  if (!r.trackingNumber) return r.shippedElsewhere ? "untracked" : "to_ship";
  const s = toStatus(r.trackingStatus);
  if (s === "DELIVERED") return "delivered";
  if (s === "RETURNED" || s === "FAILURE") return "problem";
  if (s === "TRANSIT") return "transit";
  return "label";
}

/** Whole days the order has spent in its current stage, and whether that's too long. */
export function shipTiming(r: ShipRow, now: Date): { stage: ShipStage; days: number; late: boolean } {
  const stage = shipStage(r);
  const since =
    stage === "to_ship" ? r.createdAt : stage === "label" ? r.labelCreatedAt ?? r.createdAt : stage === "transit" ? r.shippedAt ?? r.labelCreatedAt ?? r.createdAt : null;
  const days = since ? Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY_MS)) : 0;
  const late =
    stage === "problem" ||
    ((stage === "to_ship" || stage === "label") && days > LATE_TO_SHIP_DAYS) ||
    (stage === "transit" && days > LATE_IN_TRANSIT_DAYS);
  return { stage, days, late };
}

/** Shippo's carrier token for a tracking number. */
export function shippoCarrier(tracking: string): "ups" | "usps" {
  return /^1Z/i.test(tracking) ? "ups" : "usps";
}

/** The furthest stage an order has reached, from its tracking. */
export function emailStage(r: { trackingNumber: string | null; trackingStatus: string | null; shippedAt: Date | null; deliveredAt: Date | null }): "packed" | "shipped" | "delivered" | null {
  if (!r.trackingNumber) return null;
  if (r.trackingStatus === "DELIVERED" || r.deliveredAt) return "delivered";
  if (r.shippedAt || r.trackingStatus === "TRANSIT") return "shipped";
  return "packed";
}

