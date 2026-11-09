import type { LabelOrder } from "./fulfilment";

// HTML for the Pirate Ship label page (routes/labels.ts). Kept free of DB and
// Stripe imports so it can be tested on its own.

export const PIRATE_SHIP_URL = "https://ship.pirateship.com/ship";

/** The whole label page around a body. */
export function pageHtml(body: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>Shipping label</title>` +
    `<style>body{font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:32px auto;padding:0 16px;color:#111}` +
    `h1{font-size:22px;margin:0 0 4px}.muted{color:#6b7280;font-size:14px}.box{border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin:18px 0}` +
    `.btn{display:block;width:100%;box-sizing:border-box;text-align:center;background:#111;color:#fff;border:0;border-radius:6px;padding:14px;font:600 16px sans-serif;text-decoration:none;cursor:pointer;margin-top:10px}` +
    `.btn.alt{background:#fff;color:#111;border:1px solid #111}.err{color:#b91c1c;font-weight:600}` +
    `.addr{font:14px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;background:#f3f4f6;border-radius:6px;padding:10px 12px;margin:6px 0 0;overflow-wrap:anywhere}` +
    `label{display:block;font-size:14px;color:#6b7280;margin-top:14px}` +
    `input[type=text]{width:100%;box-sizing:border-box;font:15px ui-monospace,Menlo,monospace;padding:12px;border:1px solid #d1d5db;border-radius:6px;margin-top:4px}` +
    `.ok{background:#ecfdf3;color:#15803d;border-radius:6px;padding:10px 12px;font-weight:600}</style></head><body>` +
    body +
    `</body></html>`
  );
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The address as Pirate Ship's "Paste address" box takes it, email last. */
export function pasteAddress(o: LabelOrder): string {
  const locality = [o.to.city, o.to.state].filter(Boolean).join(", ");
  return [o.to.name, o.to.street1, o.to.street2, `${locality} ${o.to.zip}`.trim(), o.to.email]
    .filter(Boolean)
    .join("\n");
}

export function shipBody(o: LabelOrder, t: string, badTracking = false): string {
  const id = encodeURIComponent(o.sessionId);
  return (
    `<h1>Ship this order</h1>` +
    `<div class="box"><strong>${esc(o.item)}</strong> &times;${o.quantity}` +
    `<div class="muted" style="margin-top:8px">Ship to</div><div class="addr" id="addr">${esc(pasteAddress(o))}</div>` +
    (o.displayName ? `<div class="muted" style="margin-top:8px">Customer paid for ${esc(o.displayName)}</div>` : "") +
    `</div>` +
    `<strong>Pirate Ship</strong><div class="muted">Your return address, your account. About 1 minute.</div>` +
    `<a class="btn" id="cp" href="${PIRATE_SHIP_URL}" target="_blank" rel="noopener">Copy address + open Pirate Ship</a>` +
    `<form method="post" action="/api/labels/${id}/shipped" onsubmit="this.b.disabled=true;this.b.textContent='Saving…'">` +
    `<input type="hidden" name="t" value="${t}">` +
    `<label for="trk">Then paste the tracking number</label>` +
    `<input type="text" id="trk" name="tracking" required autocomplete="off" inputmode="text" placeholder="9400 1000 0000 0000 0000 00">` +
    (badTracking ? `<p class="err">That doesn't look like a tracking number. Copy it from Pirate Ship and try again.</p>` : "") +
    `<button class="btn alt" name="b">Mark shipped</button></form>` +
    `<a class="btn alt" href="/api/labels/${id}/pdf?t=${t}" target="_blank" style="margin-top:22px">Packing slip</a>` +
    // Copy first (needs the click), then let the link open Pirate Ship in a new tab.
    `<script>document.getElementById("cp").addEventListener("click",function(){var b=this,t=document.getElementById("addr").innerText;` +
    `try{navigator.clipboard.writeText(t).then(function(){b.textContent="Address copied. Paste it in Pirate Ship"},function(){})}catch(e){}});</script>`
  );
}

