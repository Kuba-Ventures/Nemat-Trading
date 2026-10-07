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
