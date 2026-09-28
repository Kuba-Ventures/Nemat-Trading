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

type ResendEmail = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  reply_to?: string;
};

// Never throws: a mail failure must not fail the webhook, or Stripe retries it.
async function sendViaResend(email: ResendEmail, idempotencyKey: string, tag: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(`[${tag}] RESEND_API_KEY not set, skipping`);
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Resend drops a repeat send with the same key, a second guard against dupes.
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(email),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[${tag}] Resend ${res.status}: ${await res.text()}`);
      return;
    }
    console.log(`[${tag}] sent ${idempotencyKey} to ${email.to.join(", ")}`);
  } catch (err) {
    console.error(`[${tag}] send failed:`, err);
  }
}

export async function sendOrderEmail(o: OrderEmailInput): Promise<void> {
  const email = buildOrderEmail(o);
  await sendViaResend(
    {
      from: process.env.ORDER_EMAIL_FROM || DEFAULT_FROM,
      to: [process.env.ORDER_NOTIFY_EMAIL || DEFAULT_TO],
      subject: email.subject,
      text: email.text,
      html: email.html,
      ...(email.replyTo ? { reply_to: email.replyTo } : {}),
    },
    `order-${o.sessionId}`,
    "order-email",
  );
}

// ─── Customer confirmation ───────────────────────────────────────────────────
// Stripe's own receipt can arrive minutes after checkout. This one goes out from
// the webhook the moment the order is recorded, and names the pack they bought.

export type ConfirmationPack = {
  title: string;
  subtitle: string;
  imageUrl: string;
};

const DEFAULT_SUPPORT = "support@tommytopdecker.com";

export function buildConfirmationEmail(o: OrderEmailInput, pack: ConfirmationPack | null): OrderEmail {
  const item = pack?.title || o.item || "your order";
  const qty = o.quantity || 1;
  const firstName = (o.customerName || o.shipName).trim().split(/\s+/)[0] || "";
  const total = `$${o.total}`;
  const locality = [o.city, o.state].filter(Boolean).join(", ");
  const shipTo = [o.shipName || o.customerName, o.address1, o.address2, [locality, o.zip].filter(Boolean).join(" ")]
    .filter(Boolean);
  const orderRef = o.sessionId.slice(-8).toUpperCase();

  const subject = `Order confirmed: ${item}${qty > 1 ? ` ×${qty}` : ""}`;

  const text = [
    firstName ? `Hi ${firstName},` : "Hi,",
    "",
    `Your order is confirmed. We'll email tracking as soon as it ships.`,
    "",
    `${item}${pack?.subtitle ? ` (${pack.subtitle})` : ""}  ×${qty}`,
    `Total paid: ${total}`,
    `Order #${orderRef}`,
    "",
    "SHIPPING TO",
    ...shipTo.map((l) => `  ${l}`),
    "",
    `Questions? Just reply to this email.`,
    "",
    "Tommy Top Decker Trading",
  ].join("\n");

  const html = [
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;background:#ffffff;color:#111;padding:8px 4px">`,
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.5">${esc(firstName ? `Hi ${firstName},` : "Hi,")}</p>`,
    `<p style="margin:0 0 20px;font-size:15px;line-height:1.5">Your order is confirmed. We'll email tracking as soon as it ships.</p>`,
    pack?.imageUrl
      ? `<img src="${esc(pack.imageUrl)}" alt="${esc(item)}" width="160" style="display:block;margin:0 0 16px;max-width:160px;height:auto">`
      : "",
    section(
      "Your order",
      `<strong>${esc(item)}</strong> &times;${qty}` +
        (pack?.subtitle ? `<br><span style="color:#6b7280">${esc(pack.subtitle)}</span>` : "") +
        `<br>Total paid: <strong>${esc(total)}</strong><br>Order #${esc(orderRef)}`,
    ),
    section("Shipping to", shipTo.map(esc).join("<br>")),
    `<p style="margin:0;font-size:14px;color:#6b7280">Questions? Just reply to this email.</p>`,
    `</div>`,
  ].join("");

  return { subject, text, html };
}

export async function sendConfirmationEmail(
  o: OrderEmailInput,
  pack: ConfirmationPack | null,
): Promise<void> {
  if (!o.customerEmail) return;
  const email = buildConfirmationEmail(o, pack);
  await sendViaResend(
    {
      from: process.env.ORDER_EMAIL_FROM || DEFAULT_FROM,
      to: [o.customerEmail],
      subject: email.subject,
      text: email.text,
      html: email.html,
      reply_to: process.env.SUPPORT_EMAIL || DEFAULT_SUPPORT,
    },
    `confirm-${o.sessionId}`,
    "confirm-email",
  );
}
