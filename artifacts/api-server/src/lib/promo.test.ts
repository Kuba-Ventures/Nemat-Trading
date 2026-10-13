import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCode, normalizeEmail, sessionUsedPromo } from "./promo";

test("normalizeEmail trims, lowercases and rejects junk", () => {
  assert.equal(normalizeEmail("  Sam@Example.COM "), "sam@example.com");
  assert.equal(normalizeEmail("not-an-email"), null);
  assert.equal(normalizeEmail(""), null);
  assert.equal(normalizeEmail(42), null);
});

test("normalizeCode uppercases and rejects odd characters", () => {
  assert.equal(normalizeCode(" topdeck10 "), "TOPDECK10");
  assert.equal(normalizeCode("TOP DECK"), null);
  assert.equal(normalizeCode(""), null);
  assert.equal(normalizeCode(undefined), null);
});

test("sessionUsedPromo matches the promotion code id, expanded or not", () => {
  const promoId = "promo_123";
  assert.equal(sessionUsedPromo({ discounts: [{ coupon: null, promotion_code: promoId }] } as any, promoId), true);
  assert.equal(sessionUsedPromo({ discounts: [{ coupon: null, promotion_code: { id: promoId } }] } as any, promoId), true);
  assert.equal(sessionUsedPromo({ discounts: [{ coupon: null, promotion_code: "promo_other" }] } as any, promoId), false);
  assert.equal(sessionUsedPromo({ discounts: [] }, promoId), false);
  assert.equal(sessionUsedPromo({ discounts: null }, promoId), false);
});
