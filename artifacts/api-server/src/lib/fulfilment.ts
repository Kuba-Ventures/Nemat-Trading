import type Stripe from "stripe";
import { and, eq, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { db, ordersTable, productsTable } from "@workspace/db";
import { SHIPPO_API, buyLabel, type LabelResult, type ShipTo } from "./shippo";
import { emailStage, parseShippoTrack, shippoCarrier } from "./shipStatus";
import { carrierFor } from "./tracking";
import { buildShippingPdf, fetchLabelPdf, type SlipInput } from "./packingSlip";
import { sendStatusEmail, type ConfirmationPack, type StatusStage } from "./orderEmail";

// Click-to-buy labels (issue #113, revised 2026-10-13): the sales@ email carries
// a "Buy label" link; one click buys the label, emails the customer tracking and
// opens a printable label + packing slip PDF. Nothing is bought automatically.
//
// The session must be retrieved with expand: ["line_items", "shipping_cost.shipping_rate"].

export type LabelOrder = {
  sessionId: string;
  item: string;
  quantity: number;
  created: Date;
  to: ShipTo;
  servicelevelToken: string | null;
  displayName: string | null;
};

export function labelOrderFromSession(full: Stripe.Checkout.Session): LabelOrder {
  const lineItems = full.line_items?.data ?? [];
  const addr = full.shipping_details?.address;
  const rate = full.shipping_cost?.shipping_rate;
  return {
    sessionId: full.id,
    item: lineItems.map((li) => li.description).filter(Boolean).join(", ") || "Unknown item",
    quantity: lineItems.reduce((n, li) => n + (li.quantity ?? 0), 0) || 1,
    created: new Date(full.created * 1000),
    to: {
      name: full.shipping_details?.name || full.customer_details?.name || "",
      street1: addr?.line1 ?? "",
      street2: addr?.line2 ?? "",
      city: addr?.city ?? "",
      state: addr?.state ?? "",
      zip: addr?.postal_code ?? "",
      country: addr?.country || "US",
      phone: full.customer_details?.phone ?? "",
      email: full.customer_details?.email ?? "",
    },
    servicelevelToken: full.metadata?.shippoService ?? null,
    displayName: rate && typeof rate === "object" ? rate.display_name : null,
  };
}

export function slipFor(o: LabelOrder, label?: { trackingNumber: string; service: string }): SlipInput {
  const locality = [o.to.city, o.to.state].filter(Boolean).join(", ");
  return {
    orderId: o.sessionId,
    date: o.created,
    item: o.item,
    quantity: o.quantity,
    shipTo: [o.to.name, o.to.street1, o.to.street2, [locality, o.to.zip].filter(Boolean).join(" ")].filter(Boolean),
    ...(label ?? {}),
  };
}

export type SavedLabel = {
  trackingNumber: string;
  trackingUrl: string;
  labelUrl: string;
  service: string;
  costCents: number;
};

const PENDING = "pending";
// Set by hand on orders shipped without a Shippo label (e.g. from the client's
// house). Like a real transaction id it blocks buyLabelOnce, so postage can
// never be bought for an order that already went out.
export const SHIPPED_ELSEWHERE = "shipped-elsewhere";

/** The label already bought for this order, if any. */
export async function savedLabel(sessionId: string): Promise<SavedLabel | "pending" | "shipped" | null> {
  const [row] = await db
    .select({
      tx: ordersTable.shippoTransactionId,
      trackingNumber: ordersTable.trackingNumber,
      trackingUrl: ordersTable.trackingUrl,
      labelUrl: ordersTable.labelUrl,
      shippingMethod: ordersTable.shippingMethod,
      costCents: ordersTable.labelCostCents,
    })
    .from(ordersTable)
    .where(eq(ordersTable.stripeSessionId, sessionId));
  if (!row?.tx) return null;
  if (row.tx === SHIPPED_ELSEWHERE) return "shipped";
  if (row.tx === PENDING || !row.labelUrl) return "pending";
  return {
    trackingNumber: row.trackingNumber ?? "",
    trackingUrl: row.trackingUrl ?? "",
    labelUrl: row.labelUrl,
    service: row.shippingMethod ?? "USPS",
    costCents: row.costCents ?? 0,
  };
}

/**
 * Buys the label once. The order row is claimed first, so a double click or a
 * second tab can never buy two labels. On failure the claim is released.
 */
export async function buyLabelOnce(
  o: LabelOrder,
): Promise<LabelResult | { ok: false; reason: string; already: true }> {
  const claimed = await db
    .update(ordersTable)
    .set({ shippoTransactionId: PENDING })
    .where(and(eq(ordersTable.stripeSessionId, o.sessionId), isNull(ordersTable.shippoTransactionId)))
    .returning({ id: ordersTable.id });
  if (claimed.length === 0) {
    return { ok: false, reason: "A label was already bought (or is being bought) for this order", already: true };
  }

  const label = await buyLabel({
    sessionId: o.sessionId,
    quantity: o.quantity,
    to: o.to,
    servicelevelToken: o.servicelevelToken,
    displayName: o.displayName,
  });

  if (!label.ok) {
    await db
      .update(ordersTable)
      .set({ shippoTransactionId: null })
      .where(eq(ordersTable.stripeSessionId, o.sessionId))
      .catch((err) => console.error("[label] releasing claim failed:", err));
    return label;
  }

  try {
    await db
      .update(ordersTable)
      .set({
        shippoTransactionId: label.transactionId,
        trackingNumber: label.trackingNumber,
        trackingUrl: label.trackingUrl || null,
        labelUrl: label.labelUrl,
        labelCostCents: label.costCents,
        labelCreatedAt: new Date(),
      })
      .where(eq(ordersTable.stripeSessionId, o.sessionId));
  } catch (err) {
    // The label is bought; say so loudly so it isn't bought again by hand.
    console.error(`[label] BOUGHT ${label.transactionId} for ${o.sessionId} but saving failed:`, err);
  }

  await sendStatusEmails(o.sessionId);
  return label;
}

/** Tracking saved when the order was marked shipped from Pirate Ship, if any. */
export async function shippedTracking(sessionId: string): Promise<{ trackingNumber: string; trackingUrl: string } | null> {
  const [row] = await db
    .select({ trackingNumber: ordersTable.trackingNumber, trackingUrl: ordersTable.trackingUrl })
    .from(ordersTable)
    .where(eq(ordersTable.stripeSessionId, sessionId));
  return row?.trackingNumber ? { trackingNumber: row.trackingNumber, trackingUrl: row.trackingUrl ?? "" } : null;
}

/**
 * Records a label bought in Pirate Ship. Claims the order the same way
 * buyLabelOnce does, so it only works once and blocks any other label for it.
 */
export async function markShippedOnce(
  sessionId: string,
  tracking: { trackingNumber: string; trackingUrl: string },
): Promise<boolean> {
  const claimed = await db
    .update(ordersTable)
    .set({
      shippoTransactionId: SHIPPED_ELSEWHERE,
      trackingNumber: tracking.trackingNumber,
      trackingUrl: tracking.trackingUrl,
      labelCreatedAt: new Date(),
    })
    .where(and(eq(ordersTable.stripeSessionId, sessionId), isNull(ordersTable.shippoTransactionId)))
    .returning({ id: ordersTable.id });
  return claimed.length > 0;
}

/**
 * Marks an order shipped without any tracking (a test order, or one that went
 * out long ago with no number kept). Only claims an order that has no label yet.
 */
export async function markShippedUntracked(sessionId: string): Promise<boolean> {
  const claimed = await db
    .update(ordersTable)
    .set({ shippoTransactionId: SHIPPED_ELSEWHERE })
    .where(and(eq(ordersTable.stripeSessionId, sessionId), isNull(ordersTable.shippoTransactionId)))
    .returning({ id: ordersTable.id });
  return claimed.length > 0;
}

/** Pulls the latest carrier status from Shippo and saves it on the order. Never throws. */
export async function refreshTracking(sessionId: string): Promise<void> {
  const token = process.env.SHIPPO_API_TOKEN;
  if (!token) return;
  const [row] = await db
    .select({ trackingNumber: ordersTable.trackingNumber })
    .from(ordersTable)
    .where(eq(ordersTable.stripeSessionId, sessionId));
  const number = row?.trackingNumber;
  if (!number) return;
  try {
    const res = await fetch(`${SHIPPO_API}/tracks/${shippoCarrier(number)}/${encodeURIComponent(number)}`, {
      headers: { Authorization: `ShippoToken ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Shippo tracks ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const u = parseShippoTrack(await res.json());
    await db
      .update(ordersTable)
      .set({
        trackingStatus: u.status,
        trackingStatusDetail: u.statusDetail,
        trackingLocation: u.location,
        // Keep the first scan we ever saw; Shippo can trim old history.
        shippedAt: u.shippedAt ? sql`COALESCE(${ordersTable.shippedAt}, ${u.shippedAt})` : undefined,
        deliveredAt: u.deliveredAt ?? undefined,
        trackingCheckedAt: new Date(),
      })
      .where(eq(ordersTable.stripeSessionId, sessionId));
  } catch (err) {
    console.error(`[tracking] refresh failed for ${sessionId}:`, err);
    // Still stamp the check, so one bad number doesn't get retried every run.
    await db
      .update(ordersTable)
      .set({ trackingCheckedAt: new Date() })
      .where(eq(ordersTable.stripeSessionId, sessionId))
      .catch(() => {});
  }
}

async function packForProduct(productId: number | null): Promise<ConfirmationPack | null> {
  if (!productId) return null;
  try {
    const [p] = await db
      .select({
        title: productsTable.title,
        shortTitle: productsTable.shortTitle,
        subtitle: productsTable.subtitle,
        imageUrl: productsTable.imageUrl,
        confirmHeadline: productsTable.confirmHeadline,
        accentColor: productsTable.accentColor,
      })
      .from(productsTable)
      .where(eq(productsTable.id, productId));
    return p ?? null;
  } catch {
    return null;
  }
}

const STAGE_ORDER: StatusStage[] = ["packed", "shipped", "delivered"];
const STAGE_COLUMN = {
  packed: ordersTable.trackingEmailedAt,
  shipped: ordersTable.shippedEmailedAt,
  delivered: ordersTable.deliveredEmailedAt,
} as const;
const STAGE_FIELD = { packed: "trackingEmailedAt", shipped: "shippedEmailedAt", delivered: "deliveredEmailedAt" } as const;

/**
 * Sends the customer the email for the furthest stage their order has reached
 * (Packed, Shipped or Delivered), once. Earlier stages are marked as covered, so
 * tracking added late sends one email, not three. Returns the stage sent, if any.
 */
export async function sendStatusEmails(sessionId: string, opts: { skip?: boolean } = {}): Promise<StatusStage | null> {
  const [row] = await db.select().from(ordersTable).where(eq(ordersTable.stripeSessionId, sessionId));
  if (!row) return null;
  const stage = emailStage(row);
  if (!stage || row[STAGE_FIELD[stage]]) return null;

  const now = new Date();
  const covered = STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(stage));
  const claimed = await db
    .update(ordersTable)
    .set({
      [STAGE_FIELD[stage]]: now,
      ...Object.fromEntries(covered.map((c) => [STAGE_FIELD[c], sql`COALESCE(${STAGE_COLUMN[c]}, ${now})`])),
    })
    .where(and(eq(ordersTable.stripeSessionId, sessionId), isNull(STAGE_COLUMN[stage])))
    .returning({ id: ordersTable.id });
  if (claimed.length === 0 || opts.skip) return null;

  await sendStatusEmail(
    stage,
    row.customerEmail,
    { sessionId, quantity: row.quantity, item: "" },
    await packForProduct(row.productId),
    {
      carrier: carrierFor(row.trackingNumber!),
      trackingNumber: row.trackingNumber!,
      trackingUrl: row.trackingUrl ?? "",
      shippedAt: row.shippedAt,
      deliveredAt: row.deliveredAt,
      location: row.trackingLocation,
      statusDetail: row.trackingStatusDetail,
    },
  );
  return stage;
}

const REFRESH_AFTER_MS = 3 * 60 * 60 * 1000;

/** Refreshes every order still on its way whose status is older than 3 hours. */
export async function refreshStaleTracking(now = new Date()): Promise<number> {
  const rows = await db
    .select({ sessionId: ordersTable.stripeSessionId })
    .from(ordersTable)
    .where(
      and(
        isNotNull(ordersTable.trackingNumber),
        or(isNull(ordersTable.trackingStatus), notInArray(ordersTable.trackingStatus, ["DELIVERED", "RETURNED"])),
        or(isNull(ordersTable.trackingCheckedAt), lt(ordersTable.trackingCheckedAt, new Date(now.getTime() - REFRESH_AFTER_MS))),
      ),
    );
  for (const r of rows) {
    await refreshTracking(r.sessionId);
    await sendStatusEmails(r.sessionId).catch((err) => console.error(`[tracking] status email failed for ${r.sessionId}:`, err));
  }
  return rows.length;
}

/** Label page(s) then the packing slip, ready to print. */
export async function printablePdf(o: LabelOrder, label: SavedLabel | null): Promise<Uint8Array | null> {
  return buildShippingPdf(
    slipFor(o, label ? { trackingNumber: label.trackingNumber, service: label.service } : undefined),
    label ? await fetchLabelPdf(label.labelUrl) : null,
  );
}
