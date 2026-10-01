import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attributionColumnsFromMetadata,
  attributionToMetadata,
  sanitizeAttribution,
} from "./attribution";

test("keeps only known string keys and trims them", () => {
  const out = sanitizeAttribution({
    fbclid: "  ABC  ",
    utm_source: "meta",
    productId: "999",
    utm_medium: 42,
    utm_term: "",
  });
  assert.deepEqual(out, { fbclid: "ABC", utm_source: "meta" });
});

test("non-object input yields nothing, so old clients still check out", () => {
  assert.deepEqual(sanitizeAttribution(undefined), {});
  assert.deepEqual(sanitizeAttribution("fbclid=x"), {});
  assert.deepEqual(sanitizeAttribution(["a"]), {});
});

test("caps values at Stripe's 500-character metadata limit", () => {
  const out = sanitizeAttribution({ fbclid: "x".repeat(900) });
  assert.equal(out.fbclid?.length, 500);
});

test("round-trips through Stripe metadata onto order columns", () => {
  const meta: Record<string, string> = {
    productId: "1",
    ...attributionToMetadata({ fbclid: "ABC", utm_content: "copy_a_price", landed_at: "2026-10-01T12:00:00.000Z" }),
  };
  assert.equal(meta.attr_fbclid, "ABC");
  assert.equal(meta.productId, "1");
  assert.deepEqual(attributionColumnsFromMetadata(meta), {
    fbclid: "ABC",
    fbc: null,
    fbp: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: "copy_a_price",
    utmTerm: null,
    landedAt: "2026-10-01T12:00:00.000Z",
  });
});

test("orders without attribution get all-null columns", () => {
  const cols = attributionColumnsFromMetadata({ productId: "1" });
  assert.ok(Object.values(cols).every((v) => v === null));
  assert.ok(Object.values(attributionColumnsFromMetadata(null)).every((v) => v === null));
});
