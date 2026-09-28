// New-order email to the sales inbox, sent through Resend straight from the webhook.
//
// This replaces the Apps Script notification, which sent as the script owner's
// personal account: Gmail filed every copy under that owner's Sent (never Inbox),
// and the sales@ Google Group could hold it as an outside sender. Sending from
// our own domain avoids both.

export type OrderEmailInput = {
  sessionId: string;
  item: string;
  quantity: number;
  subtotal: string;
  shipping: string;
  tax: string;
  taxRate: string;
  total: string;
  currency: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  shipName: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  paymentIntentId: string;
};

export type OrderEmail = {
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
};

const DEFAULT_TO = "sales@tommytopdecker.com";
const DEFAULT_FROM = "Tommy Top Decker Orders <orders@tommytopdecker.com>";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function section(title: string, inner: string): string {
  return (
    `<p style="margin:0 0 4px;font:600 11px/1.4 sans-serif;letter-spacing:.08em;` +
    `text-transform:uppercase;color:#6b7280">${esc(title)}</p>` +
    `<div style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#111">${inner}</div>`
  );
}

function row(label: string, valueHtml: string): string {
  return (
    `<div><span style="display:inline-block;min-width:88px;color:#6b7280">${esc(label)}</span>` +
    `${valueHtml}</div>`
  );
}

export function buildOrderEmail(o: OrderEmailInput): OrderEmail {
  // "City, ST 12345", tolerant of any part missing.
  const locality = [o.city, o.state].filter(Boolean).join(", ");
  const cityLine = [locality, o.zip].filter(Boolean).join(" ");
  const shipTo = [o.shipName || o.customerName, o.address1, o.address2, cityLine, o.country].filter(
    Boolean,
  );

  const item = o.item || "Unknown item";
  const qty = String(o.quantity || 1);
  const total = `${o.currency ? o.currency + " " : ""}${o.total}`;
  const taxLine = o.tax + (o.taxRate ? ` (${o.taxRate})` : "");
  const stripeUrl = o.paymentIntentId
    ? `https://dashboard.stripe.com/payments/${o.paymentIntentId}`
    : "";

  const subject = `New order: ${item}${qty !== "1" ? ` ×${qty}` : ""} · ${total}`;

  const text = [
    "PACKING LIST",
    `  ${item}  ×${qty}`,
    "",
    "SHIP TO",
    ...shipTo.map((l) => `  ${l}`),
    "",
    "CUSTOMER",
    `  ${o.customerEmail}`,
    ...(o.customerPhone ? [`  ${o.customerPhone}`] : []),
    "",
    "ORDER",
    `  Subtotal  ${o.subtotal}`,
    `  Shipping  ${o.shipping}`,
    `  Tax       ${taxLine}`,
    `  Total     ${total}`,
    `  Order ID  ${o.sessionId}`,
    ...(stripeUrl ? ["", `View in Stripe: ${stripeUrl}`] : []),
  ].join("\n");

  const html = [
    // Explicit white background so dark-mode clients don't invert the layout.
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;background:#ffffff;color:#111;padding:8px 4px">`,
    section("Packing list", `<strong>${esc(item)}</strong> &times;${esc(qty)}`),
    section("Ship to", shipTo.map(esc).join("<br>")),
    section(
      "Customer",
      esc(o.customerEmail) + (o.customerPhone ? `<br>${esc(o.customerPhone)}` : ""),
    ),
    section(
      "Order",
      [
        row("Subtotal", esc(o.subtotal)),
        row("Shipping", esc(o.shipping)),
        row("Tax", esc(taxLine)),
        row("Total", `<strong>${esc(total)}</strong>`),
        row("Order ID", esc(o.sessionId)),
      ].join(""),
    ),
    stripeUrl
      ? `<p style="margin:20px 0 0"><a href="${esc(stripeUrl)}">View in Stripe &rarr;</a></p>`
      : "",
    `</div>`,
  ].join("");

  // Replying to the notification reaches the customer directly.
  return { subject, text, html, ...(o.customerEmail ? { replyTo: o.customerEmail } : {}) };
}

// Never throws: a mail failure must not fail the webhook, or Stripe retries it.
export async function sendOrderEmail(o: OrderEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[order-email] RESEND_API_KEY not set, skipping new-order email");
    return;
  }
  const to = process.env.ORDER_NOTIFY_EMAIL || DEFAULT_TO;
  const from = process.env.ORDER_EMAIL_FROM || DEFAULT_FROM;
  const email = buildOrderEmail(o);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Resend drops a repeat send with the same key, a second guard against dupes.
        "Idempotency-Key": `order-${o.sessionId}`,
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: email.subject,
        text: email.text,
        html: email.html,
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[order-email] Resend ${res.status}: ${await res.text()}`);
      return;
    }
    console.log(`[order-email] sent for ${o.sessionId} to ${to}`);
  } catch (err) {
    console.error("[order-email] send failed:", err);
  }
}
