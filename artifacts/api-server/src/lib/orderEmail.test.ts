import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOrderEmail, type OrderEmailInput } from "./orderEmail";

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
