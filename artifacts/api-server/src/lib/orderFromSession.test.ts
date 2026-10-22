import { test } from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { skipBackfillSession } from "./orderFromSession";

const session = (id: string, email: string | null) =>
  ({ id, customer_details: email == null ? null : { email } }) as unknown as Stripe.Checkout.Session;

test("skipBackfillSession: team orders not already kept are skipped, everything else imports", () => {
  const kept = new Set(["cs_kept"]);
  assert.equal(skipBackfillSession(session("cs_deleted", "finley@qsbsrollover.com"), kept), true);
  assert.equal(skipBackfillSession(session("cs_kept", "finley@qsbsrollover.com"), kept), false);
  assert.equal(skipBackfillSession(session("cs_new", "buyer@gmail.com"), kept), false);
  assert.equal(skipBackfillSession(session("cs_no_email", null), kept), false);
});
