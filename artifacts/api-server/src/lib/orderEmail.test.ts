import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConfirmationEmail, buildOrderEmail, type OrderEmailInput } from "./orderEmail";

const ORDER: OrderEmailInput = {
  sessionId: "cs_test_123",
  item: "Teenage Mutant Ninja Turtles",
  quantity: 1,
  subtotal: "34.00",
  shipping: "6.07",
  tax: "0.00",
  taxRate: "",
  total: "40.07",
  currency: "USD",
  customerEmail: "buyer@example.com",
  customerName: "Test Buyer",
  customerPhone: "+1 555 010 1234",
  shipName: "Test Buyer",
  address1: "123 Example St",
  address2: "",
  city: "Austin",
  state: "TX",
  zip: "78701",
  country: "US",
  paymentIntentId: "pi_test_456",
};

test("subject names the item and total, and omits quantity when it is one", () => {
  assert.equal(buildOrderEmail(ORDER).subject, "New order: Teenage Mutant Ninja Turtles · USD 40.07");
});

test("subject shows quantity when more than one", () => {
  assert.match(buildOrderEmail({ ...ORDER, quantity: 3 }).subject, /×3 · USD 40\.07$/);
});

test("body carries the ship-to block, customer contact and Stripe link", () => {
  const { text, html } = buildOrderEmail(ORDER);
  for (const part of ["123 Example St", "Austin, TX 78701", "buyer@example.com", "+1 555 010 1234"]) {
    assert.ok(text.includes(part), `text missing ${part}`);
    assert.ok(html.includes(part), `html missing ${part}`);
  }
  assert.ok(text.includes("https://dashboard.stripe.com/payments/pi_test_456"));
});

test("reply-to is the customer so sales can answer them directly", () => {
  assert.equal(buildOrderEmail(ORDER).replyTo, "buyer@example.com");
  assert.equal(buildOrderEmail({ ...ORDER, customerEmail: "" }).replyTo, undefined);
});

test("customer-supplied fields are HTML-escaped", () => {
  const { html } = buildOrderEmail({ ...ORDER, shipName: "<script>x</script>" });
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

const PACK = {
  title: "Teenage Mutant Ninja Turtles",
  shortTitle: "TMNT Booster Pack",
  subtitle: "Collector Booster Pack",
  imageUrl: "https://example.com/tmnt.png",
  confirmHeadline: "Cowabunga.",
  accentColor: "#66ff66",
};

test("confirmation uses the pack's headline, and never says 'Pack packs'", () => {
  const { subject, html } = buildConfirmationEmail({ ...ORDER, quantity: 2 }, PACK);
  assert.equal(subject, "Cowabunga: 2 TMNT Booster packs are yours");
  assert.ok(html.includes("Cowabunga.<br>2 TMNT Booster packs are yours."));
});

test("confirmation reads correctly for a single pack", () => {
  assert.equal(buildConfirmationEmail(ORDER, PACK).subject, "Cowabunga: 1 TMNT Booster pack is yours");
});

test("confirmation falls back to 'Locked in.' and cyan when the pack has no theme", () => {
  const { subject, html } = buildConfirmationEmail(ORDER, { ...PACK, confirmHeadline: "", accentColor: "" });
  assert.equal(subject, "Locked in: 1 TMNT Booster pack is yours");
  assert.ok(html.includes("border-top:3px solid #22d3ee"));
});

test("confirmation uses the pack accent for the status strip and glow", () => {
  const { html } = buildConfirmationEmail(ORDER, PACK);
  assert.ok(html.includes("border-top:3px solid #66ff66"));
  assert.ok(html.includes("radial-gradient(circle at 50% 22%,#143314 0"));
});

test("an accent that is not a strict hex colour cannot inject CSS", () => {
  const { html } = buildConfirmationEmail(ORDER, { ...PACK, accentColor: "red;background:url(x)" });
  assert.ok(!html.includes("url(x)"));
  assert.ok(html.includes("#22d3ee"));
});

test("confirmation shows the cost breakdown, ship-to and pack image", () => {
  const { text, html } = buildConfirmationEmail(ORDER, PACK);
  for (const part of ["$34.00", "$6.07", "$40.07", "123 Example St", "Austin, TX 78701", "#CS_TEST_123".slice(-8)]) {
    assert.ok(text.includes(part), `text missing ${part}`);
    assert.ok(html.includes(part), `html missing ${part}`);
  }
  assert.ok(html.includes('src="https://example.com/tmnt.png"'));
});

test("confirmation falls back to the Stripe item name with no pack", () => {
  const { subject, html } = buildConfirmationEmail(ORDER, null);
  assert.equal(subject, "Locked in: 1 Teenage Mutant Ninja Turtles pack is yours");
  assert.ok(!html.includes("tmnt.png"));
});

test("confirmation leaves out sales-only details", () => {
  const { text, html } = buildConfirmationEmail(ORDER, PACK);
  for (const body of [text, html]) {
    assert.ok(!body.includes("dashboard.stripe.com"));
    assert.ok(!body.includes("+1 555 010 1234"));
    assert.ok(!body.includes("buyer@example.com"));
  }
});

test("confirmation escapes admin- and customer-supplied fields", () => {
  const { html } = buildConfirmationEmail(
    { ...ORDER, shipName: "<b>x</b>" },
    { ...PACK, confirmHeadline: "<script>y</script>" },
  );
  assert.ok(!html.includes("<b>x</b>"));
  assert.ok(!html.includes("<script>"));
});

test("a promotion code discount shows in both emails so the lines add up to the total", () => {
  const discounted = { ...ORDER, discount: "3.40", total: "36.67" };
  for (const { text, html } of [buildOrderEmail(discounted), buildConfirmationEmail(discounted, null)]) {
    assert.ok(text.includes("Discount") && text.includes("-") && text.includes("3.40"), "text missing discount");
    assert.ok(html.includes("Discount") && html.includes("3.40"), "html missing discount");
  }
});

test("no discount line when no promotion code was used", () => {
  for (const o of [ORDER, { ...ORDER, discount: "0.00" }]) {
    assert.ok(!buildOrderEmail(o).text.includes("Discount"));
    assert.ok(!buildConfirmationEmail(o, null).text.includes("Discount"));
  }
});

test("sales email carries the Ship with Pirate Ship link when there is one", async () => {
  const url = "https://api.example.com/api/labels/cs_test_123?t=abc";
  const withLink = buildOrderEmail(ORDER, url);
  assert.match(withLink.text, /^SHIPPING\n  Ship with Pirate Ship: https:\/\/api\.example\.com/);
  assert.ok(withLink.html.includes("Ship with Pirate Ship &rarr;"));
  assert.ok(withLink.html.includes(url));
  assert.ok(!buildOrderEmail(ORDER).text.includes("Pirate Ship"));
  assert.ok(!buildOrderEmail(ORDER, null).html.includes("Pirate Ship"));
});

test("status emails: Packed, Shipped, Delivered fill the progress bar and link the tracking number", async () => {
  const { buildStatusEmail } = await import("./orderEmail");
  const pack = {
    title: "Teenage Mutant Ninja Turtles",
    shortTitle: "TMNT Booster Pack",
    subtitle: "",
    imageUrl: "https://img.example.com/pack.png",
    confirmHeadline: "Cowabunga",
    accentColor: "#66ff66",
  };
  const t = {
    carrier: "USPS",
    trackingNumber: "9400111899223344554412",
    trackingUrl: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223344554412",
    shippedAt: new Date("2026-11-10T18:00:00Z"),
    deliveredAt: new Date("2026-11-14T20:00:00Z"),
    location: "Memphis, TN",
    statusDetail: "Delivered, Front Door/Porch",
  };
  const order = { sessionId: "cs_live_abcdefU0FFPZRK", quantity: 1, item: "" };
  const lit = (html: string) => (html.match(/border-top:3px solid #66ff66/g) ?? []).length;

  const packed = buildStatusEmail("packed", order, pack, t);
  assert.equal(packed.subject, "Packed: your TMNT Booster pack has tracking");
  assert.equal(lit(packed.html), 2);
  // One line, and the number is a link to the carrier's tracking page.
  assert.match(packed.html, /<a href="https:\/\/tools\.usps\.com[^"]*"[^>]*white-space:nowrap[^>]*>9400111899223344554412<\/a>/);
  assert.ok(packed.html.includes("TRACK PACKAGE"));
  assert.ok(packed.html.includes("https://img.example.com/pack.png"));

  const shipped = buildStatusEmail("shipped", { ...order, quantity: 2 }, pack, t);
  assert.equal(shipped.subject, "Shipped: your TMNT Booster packs are on the move");
  assert.equal(lit(shipped.html), 3);
  assert.ok(shipped.text.includes("First scanned by USPS on Nov 10. Last seen in Memphis, TN."));

  const delivered = buildStatusEmail("delivered", order, pack, t);
  assert.equal(delivered.subject, "Delivered: time to rip your TMNT Booster pack");
  assert.equal(lit(delivered.html), 4);
  assert.ok(delivered.html.includes("Delivered Nov 14 · Front Door/Porch"));
  assert.ok(delivered.html.includes("TOPDECK10"));
  assert.ok(delivered.html.includes("utm_campaign=delivered"));

  // Confirmation now shows the same four steps, first one lit.
  const conf = buildConfirmationEmail(ORDER, pack);
  assert.equal(lit(conf.html), 1);
  assert.ok(conf.html.includes(">Delivered</td>"));
});
