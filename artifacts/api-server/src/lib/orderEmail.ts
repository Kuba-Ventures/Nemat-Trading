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
  // Promotion code discount, e.g. "3.40". Omitted or "0.00" when none was used.
  discount?: string;
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

function isDiscounted(o: OrderEmailInput): boolean {
  return !!o.discount && Number(o.discount) > 0;
}

// labelUrl: the signed "Ship with Pirate Ship" page for this order (routes/labels.ts).
export function buildOrderEmail(o: OrderEmailInput, labelUrl?: string | null): OrderEmail {
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
  const hasDiscount = isDiscounted(o);
  const stripeUrl = o.paymentIntentId
    ? `https://dashboard.stripe.com/payments/${o.paymentIntentId}`
    : "";

  const subject = `New order: ${item}${qty !== "1" ? ` ×${qty}` : ""} · ${total}`;

  const text = [
    ...(labelUrl ? ["SHIPPING", `  Ship with Pirate Ship: ${labelUrl}`, ""] : []),
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
    ...(hasDiscount ? [`  Discount  -${o.discount}`] : []),
    `  Shipping  ${o.shipping}`,
    `  Tax       ${taxLine}`,
    `  Total     ${total}`,
    `  Order ID  ${o.sessionId}`,
    ...(stripeUrl ? ["", `View in Stripe: ${stripeUrl}`] : []),
  ].join("\n");

  const html = [
    // Explicit white background so dark-mode clients don't invert the layout.
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;background:#ffffff;color:#111;padding:8px 4px">`,
    labelUrl
      ? `<p style="margin:0 0 20px"><a href="${esc(labelUrl)}" style="display:inline-block;background:#111;color:#fff;` +
        `font:600 15px sans-serif;padding:12px 22px;border-radius:6px;text-decoration:none">Ship with Pirate Ship &rarr;</a>` +
        `<br><span style="font-size:13px;color:#6b7280">Copy the address into Pirate Ship, then paste the tracking number back. ` +
        `The packing slip is attached.</span></p>`
      : "",
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
        ...(hasDiscount ? [row("Discount", esc(`-${o.discount}`))] : []),
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
  attachments?: Array<{ filename: string; content: string }>;
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

export async function sendOrderEmail(
  o: OrderEmailInput,
  labelUrl?: string | null,
  pdf?: Uint8Array | null,
): Promise<void> {
  const email = buildOrderEmail(o, labelUrl);
  await sendViaResend(
    {
      from: process.env.ORDER_EMAIL_FROM || DEFAULT_FROM,
      to: [process.env.ORDER_NOTIFY_EMAIL || DEFAULT_TO],
      subject: email.subject,
      text: email.text,
      html: email.html,
      ...(email.replyTo ? { reply_to: email.replyTo } : {}),
      ...(pdf
        ? {
            attachments: [
              {
                filename: `packing-slip-${o.sessionId.slice(-8)}.pdf`,
                content: Buffer.from(pdf).toString("base64"),
              },
            ],
          }
        : {}),
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

// "TMNT Booster Pack" reads as "2 TMNT Booster packs", never "Pack packs".
function packName(pack: ConfirmationPack | null, item: string | undefined): string {
  return (pack?.shortTitle || pack?.title || item || "").replace(/\s+packs?$/i, "").trim();
}

const STEPS = ["Confirmed", "Packed", "Shipped", "Delivered"];

// Dark by design. Gmail drops the gradient and the tilt and shows flat black
// with an upright pack; Apple Mail renders both.
function emailShellStart(accent: string): string {
  return (
    `<div style="margin:0;background:#000000">` +
    `<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#000000" style="background:#000000"><tr><td align="center">` +
    `<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#000000" style="max-width:480px;background:#000000;` +
    `background-image:radial-gradient(circle at 50% 22%,${glowOf(accent)} 0,#000000 55%)">` +
    `<tr><td align="center" style="padding:28px 0 0">` +
    `<img src="${SITE_URL}/favicon.png" width="28" height="28" alt="" style="vertical-align:middle">` +
    ` <span style="vertical-align:middle;display:inline-block;text-align:left">` +
    `<span style="display:block;font:700 11px Helvetica,Arial,sans-serif;letter-spacing:.16em;color:#f4f0e8">TOMMYTOPDECKER</span>` +
    `<span style="display:block;font:700 8px Helvetica,Arial,sans-serif;letter-spacing:.3em;color:#c85a5a;margin-top:3px">TRADING CARDS</span>` +
    `</span></td></tr>`
  );
}

function packImageRow(pack: ConfirmationPack | null): string {
  return pack?.imageUrl
    ? `<tr><td align="center" style="padding:6px 0 0"><img src="${esc(absoluteUrl(pack.imageUrl))}" width="220" ` +
        `alt="${esc(pack.title)}" style="display:block;max-width:220px;height:auto;transform:rotate(-6deg)"></td></tr>`
    : "";
}

/** Confirmed → Packed → Shipped → Delivered, with the first `lit` steps in the accent. */
export function progressBar(accent: string, lit: number): string {
  const step = (t: string, on: boolean) =>
    `<td style="border-top:3px solid ${on ? accent : "#333333"};color:${on ? accent : "#666666"};padding-top:8px">${t}</td>`;
  return (
    `<tr><td style="padding:24px 28px 0"><table width="100%" cellpadding="0" cellspacing="0" ` +
    `style="font:700 10px Helvetica,Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;text-align:center"><tr>` +
    STEPS.map((t, i) => step(t, i < lit)).join(`<td width="4"></td>`) +
    `</tr></table></td></tr>`
  );
}

export function buildConfirmationEmail(o: OrderEmailInput, pack: ConfirmationPack | null): OrderEmail {
  const qty = o.quantity || 1;
  const name = packName(pack, o.item);
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
    ...(isDiscounted(o) ? [`  Discount  -$${o.discount}`] : []),
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
  const totalCell = "padding-top:8px;border-top:1px solid #333333;font-weight:700";

  const html = [
    emailShellStart(accent),
    `<tr><td align="center" style="padding:26px 20px 0;font:700 10px Helvetica,Arial,sans-serif;letter-spacing:.3em;color:#c85a5a">ORDER CONFIRMED</td></tr>`,
    `<tr><td align="center" style="padding:8px 20px 16px;${HEADLINE_FONT};font-size:36px;line-height:1.02;color:#ffffff">` +
      `${esc(opener)}<br>${esc(claim)}</td></tr>`,
    packImageRow(pack),
    progressBar(accent, 1),
    `<tr><td style="padding:18px 28px 0"><table width="100%" cellpadding="0" cellspacing="0" ` +
      `style="font:14px/1.5 Helvetica,Arial,sans-serif;color:#ffffff">`,
    label(`Order #${orderRef}`, true),
    line(`${lineLabel} ×${qty}`, `$${o.subtotal}`),
    ...(isDiscounted(o) ? [line("Discount", `-$${o.discount}`)] : []),
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

// ─── Tracking ────────────────────────────────────────────────────────────────
// Sent when the label is bought. USPS tracking starts updating at the first scan.

// ─── Status emails: Packed, Shipped, Delivered ─────────────────────────────
// Same look as the confirmation (pack image, accent, progress bar). The bar fills
// one more step each time: Confirmed → Packed → Shipped → Delivered.

export type StatusStage = "packed" | "shipped" | "delivered";

export type StatusTarget = { sessionId: string; quantity: number; item: string };

export type StatusTracking = {
  carrier: string; // "USPS" | "UPS"
  trackingNumber: string;
  trackingUrl: string;
  shippedAt?: Date | null;
  deliveredAt?: Date | null;
  location?: string | null;
  statusDetail?: string | null;
};

const STEP_LIT: Record<StatusStage, number> = { packed: 2, shipped: 3, delivered: 4 };

const emailDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

export function buildStatusEmail(
  stage: StatusStage,
  o: StatusTarget,
  pack: ConfirmationPack | null,
  t: StatusTracking,
): OrderEmail {
  const qty = o.quantity || 1;
  const name = packName(pack, o.item);
  const packs = name ? `${qty} ${name} ${qty === 1 ? "pack" : "packs"}` : "order";
  const your = name ? `your ${name} ${qty === 1 ? "pack" : "packs"}` : "your order";
  const accent = accentOf(pack);
  const orderRef = o.sessionId.slice(-8).toUpperCase();
  const shopUrl = `${SITE_URL}/?utm_source=email&utm_medium=email&utm_campaign=${stage}`;

  const copy = {
    packed: {
      subject: `Packed: ${your} ${qty === 1 ? "has" : "have"} tracking`,
      eyebrow: "PACKED AND LABELED",
      headline: ["Packed.", "Tracking's live."],
      note: `Tracking starts updating once ${t.carrier} scans it, usually within a day.`,
      button: { label: "TRACK PACKAGE", href: t.trackingUrl },
    },
    shipped: {
      subject: `Shipped: ${your} ${qty === 1 ? "is" : "are"} on the move`,
      eyebrow: "SHIPPED",
      headline: ["It's on", "the move."],
      note: [
        t.shippedAt ? `First scanned by ${t.carrier} on ${emailDate(t.shippedAt)}.` : `${t.carrier} has it.`,
        t.location ? `Last seen in ${t.location}.` : "",
      ].filter(Boolean).join(" "),
      button: { label: "TRACK PACKAGE", href: t.trackingUrl },
    },
    delivered: {
      subject: `Delivered: time to rip ${your}`,
      eyebrow: "DELIVERED",
      headline: ["It's there.", "Go rip it."],
      note: "",
      button: { label: "SHOP THE NEXT DROP", href: shopUrl },
    },
  }[stage];

  const deliveredLine = [t.deliveredAt ? `Delivered ${emailDate(t.deliveredAt)}` : "Delivered", t.statusDetail?.replace(/^Delivered,?\s*/i, "")]
    .filter(Boolean)
    .join(" · ");

  const text = [
    copy.eyebrow,
    `${copy.headline.join(" ")} (${packs})`,
    "",
    `Order #${orderRef} · ${t.carrier}`,
    `Tracking: ${t.trackingNumber}`,
    ...(t.trackingUrl ? [t.trackingUrl] : []),
    "",
    ...(stage === "delivered"
      ? [deliveredLine, "Pull something good? Reply with a photo, we'd love to see it.", "Your next pack: TOPDECK10 takes 10% off.", "", shopUrl]
      : [copy.note, "Questions? Just reply to this email.", "", SITE_URL]),
  ].join("\n");

  const label = (txt: string) =>
    `<tr><td style="padding:14px 0 6px;border-top:1px solid #222222;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#9ca3af">${esc(txt)}</td></tr>`;
  // One line, and the number itself opens the carrier's tracking page.
  const trackingRow = t.trackingUrl
    ? `<tr><td align="center" style="padding:8px 0 4px;white-space:nowrap"><a href="${esc(t.trackingUrl)}" ` +
      `style="font:700 15px/1.4 'Courier New',monospace;letter-spacing:.02em;color:#ffffff;text-decoration:underline;white-space:nowrap">` +
      `${esc(t.trackingNumber)}</a></td></tr>`
    : `<tr><td align="center" style="padding:8px 0 4px;font:700 15px/1.4 'Courier New',monospace;white-space:nowrap;color:#ffffff">${esc(t.trackingNumber)}</td></tr>`;
  const small = (txt: string, color = "#9ca3af") =>
    txt ? `<tr><td align="center" style="padding:6px 0 0;font:12px/1.5 Helvetica,Arial,sans-serif;color:${color}">${txt}</td></tr>` : "";

  const body =
    stage === "delivered"
      ? label(deliveredLine) +
        small("Pull something good? Reply with a photo, we&#39;d love to see it.", "#d1d5db") +
        small(`Your next pack: <span style="color:#ffffff;font-weight:700">TOPDECK10</span> takes 10% off.`) +
        label(`Order #${orderRef} · ${t.carrier}`) +
        trackingRow
      : label(`Order #${orderRef} · ${t.carrier}`) + trackingRow + small(esc(copy.note));

  const html = [
    emailShellStart(accent),
    `<tr><td align="center" style="padding:26px 20px 0;font:700 10px Helvetica,Arial,sans-serif;letter-spacing:.3em;color:#c85a5a">${copy.eyebrow}</td></tr>`,
    `<tr><td align="center" style="padding:8px 20px 16px;${HEADLINE_FONT};font-size:32px;line-height:1.02;color:#ffffff">` +
      `${copy.headline.map(esc).join("<br>")}</td></tr>`,
    packImageRow(pack),
    progressBar(accent, STEP_LIT[stage]),
    `<tr><td style="padding:18px 28px 0"><table width="100%" cellpadding="0" cellspacing="0" style="font:14px/1.5 Helvetica,Arial,sans-serif;color:#ffffff">`,
    body,
    `</table></td></tr>`,
    stage === "delivered" ? "" : small("Questions? Just reply to this email."),
    copy.button.href
      ? `<tr><td align="center" style="padding:20px 0 36px"><a href="${esc(copy.button.href)}" style="display:inline-block;background:#22d3ee;` +
        `color:#000000;font:700 11px Helvetica,Arial,sans-serif;letter-spacing:.25em;padding:12px 30px;border-radius:4px;` +
        `text-decoration:none">${copy.button.label}</a></td></tr>`
      : `<tr><td style="padding:0 0 36px"></td></tr>`,
    `</table></td></tr></table></div>`,
  ].join("");

  return { subject: copy.subject, text, html };
}

export async function sendStatusEmail(
  stage: StatusStage,
  customerEmail: string,
  o: StatusTarget,
  pack: ConfirmationPack | null,
  t: StatusTracking,
): Promise<void> {
  if (!customerEmail || !t.trackingNumber) return;
  const email = buildStatusEmail(stage, o, pack, t);
  await sendViaResend(
    {
      from: process.env.ORDER_EMAIL_FROM || DEFAULT_FROM,
      to: [customerEmail],
      subject: email.subject,
      text: email.text,
      html: email.html,
      reply_to: process.env.SUPPORT_EMAIL || DEFAULT_SUPPORT,
    },
    `${stage}-${o.sessionId}`,
    `${stage}-email`,
  );
}
