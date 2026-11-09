import { Router, type Response } from "express";
import Stripe from "stripe";
import { verifyLabelToken } from "../lib/labelLink";
import {
  buyLabelOnce,
  labelOrderFromSession,
  markShippedOnce,
  printablePdf,
  savedLabel,
  shippedTracking,
  type LabelOrder,
  type SavedLabel,
} from "../lib/fulfilment";
import { carrierFor, normalizeTracking, trackingUrlFor } from "../lib/tracking";
import { esc, pageHtml, shipBody } from "../lib/labelPage";

// The page behind the "Ship with Pirate Ship" button in the sales@ order email.
// Pirate Ship has no API, so the client copies the address into Pirate Ship,
// buys the label there, and pastes the tracking number back here.
//   GET  /labels/:id?t=         shows the order, Copy address + open Pirate Ship,
//                               and the tracking form (a GET never changes anything:
//                               mail scanners open links)
//   POST /labels/:id/shipped    saves the tracking number once and marks the order shipped
//   POST /labels/:id            legacy one-click label purchase, no longer linked from the page
//   GET  /labels/:id/pdf?t=     packing slip (with the label, for orders that have one)


const router = Router();

function page(res: Response, status: number, body: string) {
  res
    .status(status)
    .set("Cache-Control", "no-store")
    .set("X-Robots-Tag", "noindex")
    .type("html")
    .send(pageHtml(body));
}

async function loadOrder(id: string): Promise<LabelOrder | null> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !id.startsWith("cs_")) return null;
  try {
    const full = await new Stripe(key).checkout.sessions.retrieve(id, {
      expand: ["line_items", "shipping_cost.shipping_rate"],
    });
    return full.payment_status === "paid" ? labelOrderFromSession(full) : null;
  } catch {
    return null;
  }
}

function orderBox(o: LabelOrder): string {
  const locality = [o.to.city, o.to.state].filter(Boolean).join(", ");
  const to = [o.to.name, o.to.street1, o.to.street2, `${locality} ${o.to.zip}`.trim()].filter(Boolean);
  return (
    `<div class="box"><strong>${esc(o.item)}</strong> &times;${o.quantity}` +
    `<div class="muted" style="margin-top:8px">Ship to</div>${to.map(esc).join("<br>")}` +
    (o.displayName ? `<div class="muted" style="margin-top:8px">Customer paid for ${esc(o.displayName)}</div>` : "") +
    `</div>`
  );
}

function boughtBody(o: LabelOrder, l: SavedLabel, t: string, justBought: boolean): string {
  const pdf = `/api/labels/${encodeURIComponent(o.sessionId)}/pdf?t=${t}`;
  return (
    `<h1>${justBought ? "Label bought" : "Label already bought"}</h1>` +
    `<p class="muted">${esc(l.service)}${l.costCents ? ` &middot; $${(l.costCents / 100).toFixed(2)} postage` : ""}` +
    `<br>Tracking ${esc(l.trackingNumber)}${justBought ? ". The customer has been emailed." : ""}</p>` +
    orderBox(o) +
    `<a class="btn" href="${pdf}" target="_blank">Print label + packing slip</a>` +
    `<p class="muted" style="margin-top:18px">Cancelled order? Ask Finley to void the label within 30 days for a postage refund.</p>`
  );
}

router.get("/labels/:id", async (req, res) => {
  const { id } = req.params;
  const t = String(req.query.t ?? "");
  if (!verifyLabelToken(id, t)) return page(res, 403, `<h1>Link not valid</h1><p>Open it from the order email.</p>`);
  const o = await loadOrder(id);
  if (!o) return page(res, 404, `<h1>Order not found</h1><p class="muted">${esc(id)}</p>`);

  const saved = await savedLabel(id);
  if (saved === "pending") return page(res, 200, `<h1>Buying the label&hellip;</h1><p>Refresh in a few seconds.</p>`);
  if (saved === "shipped") return page(res, 200, await shippedBody(o, t, req.query.shipped === "1"));
  if (saved) return page(res, 200, boughtBody(o, saved, t, req.query.bought === "1"));
  return page(res, 200, shipBody(o, t, req.query.err === "tracking"));
});

async function shippedBody(o: LabelOrder, t: string, justShipped: boolean): Promise<string> {
  const tracking = await shippedTracking(o.sessionId);
  return (
    `<h1>${justShipped ? "Marked shipped" : "Already shipped"}</h1>` +
    (tracking
      ? `<p class="muted">Tracking ${tracking.trackingUrl ? `<a href="${esc(tracking.trackingUrl)}" target="_blank" rel="noopener">${esc(tracking.trackingNumber)}</a>` : esc(tracking.trackingNumber)}</p>`
      : `<p class="muted">This order is marked as shipped.</p>`) +
    orderBox(o) +
    `<a class="btn alt" href="/api/labels/${encodeURIComponent(o.sessionId)}/pdf?t=${t}" target="_blank">Packing slip</a>`
  );
}

router.post("/labels/:id/shipped", async (req, res) => {
  const { id } = req.params;
  const t = String(req.body?.t ?? "");
  if (!verifyLabelToken(id, t)) return page(res, 403, `<h1>Link not valid</h1>`);
  const back = `/api/labels/${encodeURIComponent(id)}?t=${t}`;
  const trackingNumber = normalizeTracking(req.body?.tracking);
  if (!trackingNumber) return res.redirect(303, `${back}&err=tracking`);
  const o = await loadOrder(id);
  if (!o) return page(res, 404, `<h1>Order not found</h1>`);

  const saved = await markShippedOnce(id, { trackingNumber, trackingUrl: trackingUrlFor(trackingNumber) });
  if (saved) console.log(`[label] ${id} marked shipped via Pirate Ship (${carrierFor(trackingNumber)})`);
  // Post/redirect/get. If it was already shipped the page just says so.
  res.redirect(303, saved ? `${back}&shipped=1` : back);
});

router.post("/labels/:id", async (req, res) => {
  const { id } = req.params;
  const t = String(req.body?.t ?? "");
  if (!verifyLabelToken(id, t)) return page(res, 403, `<h1>Link not valid</h1>`);
  const o = await loadOrder(id);
  if (!o) return page(res, 404, `<h1>Order not found</h1>`);

  const result = await buyLabelOnce(o);
  if (!result.ok && !("already" in result)) {
    return page(
      res,
      502,
      `<h1>Label not bought</h1><p class="err">${esc(result.reason)}</p>` +
        `<p>Nothing was charged. Fix the problem and try again.</p>` +
        `<a class="btn" href="/api/labels/${encodeURIComponent(id)}?t=${t}">Back</a>`,
    );
  }
  // Post/redirect/get, so a refresh can't resubmit.
  res.redirect(303, `/api/labels/${encodeURIComponent(id)}?t=${t}&bought=1`);
});

router.get("/labels/:id/pdf", async (req, res) => {
  const { id } = req.params;
  if (!verifyLabelToken(id, String(req.query.t ?? ""))) return page(res, 403, `<h1>Link not valid</h1>`);
  const o = await loadOrder(id);
  if (!o) return page(res, 404, `<h1>Order not found</h1>`);
  const saved = await savedLabel(id);
  const pdf = await printablePdf(o, saved && saved !== "pending" && saved !== "shipped" ? saved : null);
  if (!pdf) return page(res, 500, `<h1>Couldn't build the PDF</h1>`);
  res
    .set("Cache-Control", "no-store")
    .type("application/pdf")
    .set("Content-Disposition", `inline; filename="label-${id.slice(-8)}.pdf"`)
    .send(Buffer.from(pdf));
});

export default router;
