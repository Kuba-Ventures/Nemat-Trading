import { Router, type Response } from "express";
import Stripe from "stripe";
import { verifyLabelToken } from "../lib/labelLink";
import {
  buyLabelOnce,
  labelOrderFromSession,
  printablePdf,
  savedLabel,
  type LabelOrder,
  type SavedLabel,
} from "../lib/fulfilment";

// The page behind the "Buy label" button in the sales@ order email.
//   GET  /labels/:id?t=     shows the order and a Buy button (never buys: mail
//                           scanners open links, so a GET must be safe)
//   POST /labels/:id        buys the label once, then shows Print
//   GET  /labels/:id/pdf?t= label + packing slip, or the slip alone before purchase

const router = Router();

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function page(res: Response, status: number, body: string) {
  res
    .status(status)
    .set("Cache-Control", "no-store")
    .set("X-Robots-Tag", "noindex")
    .type("html")
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width,initial-scale=1"><title>Shipping label</title>` +
        `<style>body{font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:32px auto;padding:0 16px;color:#111}` +
        `h1{font-size:22px;margin:0 0 4px}.muted{color:#6b7280;font-size:14px}.box{border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin:18px 0}` +
        `.btn{display:block;width:100%;box-sizing:border-box;text-align:center;background:#111;color:#fff;border:0;border-radius:6px;padding:14px;font:600 16px sans-serif;text-decoration:none;cursor:pointer;margin-top:10px}` +
        `.btn.alt{background:#fff;color:#111;border:1px solid #111}.err{color:#b91c1c;font-weight:600}</style></head><body>` +
        body +
        `</body></html>`,
    );
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
    `<p class="muted" style="margin-top:18px">Cancelled order? Void the label in Shippo within 30 days for a postage refund.</p>`
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
  if (saved) return page(res, 200, boughtBody(o, saved, t, req.query.bought === "1"));

  return page(
    res,
    200,
    `<h1>Buy shipping label</h1><p class="muted">One USPS label, charged to the Shippo account. The customer gets their tracking email.</p>` +
      orderBox(o) +
      `<form method="post" action="/api/labels/${encodeURIComponent(id)}" onsubmit="this.b.disabled=true;this.b.textContent='Buying…'">` +
      `<input type="hidden" name="t" value="${t}"><button class="btn" name="b">Buy label</button></form>` +
      `<a class="btn alt" href="/api/labels/${encodeURIComponent(id)}/pdf?t=${t}" target="_blank">Packing slip only</a>`,
  );
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
        `<p>Nothing was charged. Fix the problem and try again, or buy it by hand in Shippo.</p>` +
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
  const pdf = await printablePdf(o, saved && saved !== "pending" ? saved : null);
  if (!pdf) return page(res, 500, `<h1>Couldn't build the PDF</h1>`);
  res
    .set("Cache-Control", "no-store")
    .type("application/pdf")
    .set("Content-Disposition", `inline; filename="label-${id.slice(-8)}.pdf"`)
    .send(Buffer.from(pdf));
});

export default router;
