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
  shortTitle: string;
  subtitle: string;
  imageUrl: string;
  confirmHeadline: string; // e.g. "Cowabunga."; "" falls back to "Locked in."
  accentColor: string; // "#rrggbb"; anything else falls back to brand cyan
};

const DEFAULT_SUPPORT = "support@tommytopdecker.com";
const SITE_URL = "https://www.tommytopdecker.com";
const DEFAULT_ACCENT = "#22d3ee";
const DEFAULT_HEADLINE = "Locked in.";
const HEADLINE_FONT = "font-family:'Arial Black',Impact,Helvetica,sans-serif;font-weight:900;text-transform:uppercase";

// Admin-entered, and it lands in a style attribute, so only a strict hex passes.
function accentOf(pack: ConfirmationPack | null): string {
  const c = pack?.accentColor?.trim() ?? "";
  return /^#[0-9a-f]{6}$/i.test(c) ? c : DEFAULT_ACCENT;
}

// The accent at ~20% over black, for the glow behind the headline.
function glowOf(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * 0.2).toString(16).padStart(2, "0");
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

function absoluteUrl(url: string): string {
  return url.startsWith("/") ? SITE_URL + url : url;
}

export function buildConfirmationEmail(o: OrderEmailInput, pack: ConfirmationPack | null): OrderEmail {
  const qty = o.quantity || 1;
  // "TMNT Booster Pack" reads as "2 TMNT Booster packs", never "Pack packs".
  const name = (pack?.shortTitle || pack?.title || o.item || "").replace(/\s+packs?$/i, "").trim();
  const opener = pack?.confirmHeadline?.trim() || DEFAULT_HEADLINE;
  const claim = name ? `${qty} ${name} ${qty === 1 ? "pack is" : "packs are"} yours.` : "Your order is in.";
  const accent = accentOf(pack);
  const orderRef = o.sessionId.slice(-8).toUpperCase();
  const lineLabel = pack?.title || o.item || "Your order";
  const locality = [o.city, o.state].filter(Boolean).join(", ");
  const shipTo = [o.shipName || o.customerName, o.address1, o.address2, [locality, o.zip].filter(Boolean).join(" ")]
    .filter(Boolean);

  const subject = `${opener.replace(/[.!]+$/, "")}: ${claim.replace(/\.$/, "")}`;

  const text = [
    "ORDER CONFIRMED",
    `${opener} ${claim}`,
    "",
    `Order #${orderRef}`,
    `  ${lineLabel} ×${qty}  $${o.subtotal}`,
    `  Shipping  $${o.shipping}`,
    `  Tax       $${o.tax}`,
    `  Total paid  $${o.total}`,
    "",
    "SHIPPING TO",
    ...shipTo.map((l) => `  ${l}`),
    "",
    "We'll email tracking as soon as it ships. Questions? Just reply to this email.",
    "",
    SITE_URL,
  ].join("\n");

  const label = (t: string, first = false) =>
    `<tr><td colspan="2" style="padding:${first ? "14px" : "18px"} 0 6px;border-top:1px solid #222222;` +
    `font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#9ca3af">${esc(t)}</td></tr>`;
  const line = (l: string, v: string) =>
    `<tr><td style="color:#9ca3af">${esc(l)}</td><td align="right">${esc(v)}</td></tr>`;
  const step = (t: string, on: boolean) =>
    `<td style="border-top:3px solid ${on ? accent : "#333333"};color:${on ? accent : "#666666"};padding-top:8px">${t}</td>`;
  const totalCell = "padding-top:8px;border-top:1px solid #333333;font-weight:700";

  // Dark by design. Gmail drops the gradient and the tilt and shows flat black
  // with an upright pack; Apple Mail renders both.
  const html = [
    `<div style="margin:0;background:#000000">`,
    `<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#000000" style="background:#000000"><tr><td align="center">`,
    `<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#000000" style="max-width:480px;background:#000000;` +
      `background-image:radial-gradient(circle at 50% 22%,${glowOf(accent)} 0,#000000 55%)">`,
    `<tr><td align="center" style="padding:28px 0 0">` +
      `<img src="${SITE_URL}/favicon.png" width="28" height="28" alt="" style="vertical-align:middle">` +
      ` <span style="vertical-align:middle;display:inline-block;text-align:left">` +
      `<span style="display:block;font:700 11px Helvetica,Arial,sans-serif;letter-spacing:.16em;color:#f4f0e8">TOMMYTOPDECKER</span>` +
      `<span style="display:block;font:700 8px Helvetica,Arial,sans-serif;letter-spacing:.3em;color:#c85a5a;margin-top:3px">TRADING CARDS</span>` +
      `</span></td></tr>`,
    `<tr><td align="center" style="padding:26px 20px 0;font:700 10px Helvetica,Arial,sans-serif;letter-spacing:.3em;color:#c85a5a">ORDER CONFIRMED</td></tr>`,
    `<tr><td align="center" style="padding:8px 20px 16px;${HEADLINE_FONT};font-size:36px;line-height:1.02;color:#ffffff">` +
      `${esc(opener)}<br>${esc(claim)}</td></tr>`,
    pack?.imageUrl
      ? `<tr><td align="center" style="padding:6px 0 0"><img src="${esc(absoluteUrl(pack.imageUrl))}" width="220" ` +
        `alt="${esc(pack.title)}" style="display:block;max-width:220px;height:auto;transform:rotate(-6deg)"></td></tr>`
      : "",
    `<tr><td style="padding:24px 28px 0"><table width="100%" cellpadding="0" cellspacing="0" ` +
      `style="font:700 10px Helvetica,Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;text-align:center"><tr>` +
      `${step("Confirmed", true)}<td width="4"></td>${step("Packed", false)}<td width="4"></td>${step("Shipped", false)}` +
      `</tr></table></td></tr>`,
    `<tr><td style="padding:18px 28px 0"><table width="100%" cellpadding="0" cellspacing="0" ` +
      `style="font:14px/1.5 Helvetica,Arial,sans-serif;color:#ffffff">`,
    label(`Order #${orderRef}`, true),
    line(`${lineLabel} ×${qty}`, `$${o.subtotal}`),
    line("Shipping", `$${o.shipping}`),
    line("Tax", `$${o.tax}`),
    `<tr><td style="${totalCell}">Total paid</td><td align="right" style="${totalCell}">${esc(`$${o.total}`)}</td></tr>`,
    label("Shipping to"),
    `<tr><td colspan="2" style="padding-bottom:4px">${shipTo.map(esc).join("<br>")}</td></tr>`,
    `</table></td></tr>`,
    `<tr><td align="center" style="padding:22px 28px 0;font:12px/1.5 Helvetica,Arial,sans-serif;color:#9ca3af">` +
      `We'll email tracking as soon as it ships. Questions? Just reply to this email.</td></tr>`,
    `<tr><td align="center" style="padding:20px 0 36px"><a href="${SITE_URL}" style="display:inline-block;background:#22d3ee;` +
      `color:#000000;font:700 11px Helvetica,Arial,sans-serif;letter-spacing:.25em;padding:12px 30px;border-radius:4px;` +
      `text-decoration:none">BACK TO SHOP</a></td></tr>`,
    `</table></td></tr></table></div>`,
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
