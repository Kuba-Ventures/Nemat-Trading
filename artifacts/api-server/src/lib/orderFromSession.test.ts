import { test } from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { isFullyRefunded, skipBackfillSession } from "./orderFromSession";

const session = (id: string, email: string | null, refundedCents: number | null = null, totalCents = 4007) =>
  ({
    id,
    amount_total: totalCents,
    customer_details: email == null ? null : { email },
    payment_intent: refundedCents == null ? "pi_x" : { latest_charge: { amount_refunded: refundedCents } },
  }) as unknown as Stripe.Checkout.Session;

test("skipBackfillSession: team orders not already kept are skipped, everything else imports", () => {
  const kept = new Set(["cs_kept"]);
  assert.equal(skipBackfillSession(session("cs_deleted", "finley@qsbsrollover.com"), kept), true);
  assert.equal(skipBackfillSession(session("cs_kept", "finley@qsbsrollover.com"), kept), false);
  assert.equal(skipBackfillSession(session("cs_new", "buyer@gmail.com"), kept), false);
  assert.equal(skipBackfillSession(session("cs_no_email", null), kept), false);
});

test("isFullyRefunded: only a charge refunded for the whole total", () => {
  assert.equal(isFullyRefunded(session("cs", "a@b.com", 4007)), true);
  assert.equal(isFullyRefunded(session("cs", "a@b.com", 1000)), false);
  assert.equal(isFullyRefunded(session("cs", "a@b.com", 0)), false);
  assert.equal(isFullyRefunded(session("cs", "a@b.com")), false); // charge not expanded
});

test("skipBackfillSession: refunded orders not already kept are skipped", () => {
  const kept = new Set(["cs_kept"]);
  assert.equal(skipBackfillSession(session("cs_new", "buyer@gmail.com", 4007), kept), true);
  assert.equal(skipBackfillSession(session("cs_new", "buyer@gmail.com", 1000), kept), false);
  assert.equal(skipBackfillSession(session("cs_kept", "buyer@gmail.com", 4007), kept), false);
});
