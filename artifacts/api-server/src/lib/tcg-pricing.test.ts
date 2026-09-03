import { test } from "node:test";
import assert from "node:assert/strict";
import { buildListingsRequestBody, pickBuyBoxPrice, type TcgListing } from "./tcg-pricing";

// Real-shaped sample: the listings TCGPlayer returned for product 657851, sorted
// by item price ascending (the order the search API gives us). The buy box on the
// product page showed $42.75 free-shipping (DarkeDepthsGaming) — NOT the $39.99
// listing, whose $7.50 shipping makes it $47.49 delivered.
const SAMPLE_LISTINGS: TcgListing[] = [
  { price: 39.99, shippingPrice: 7.5 }, // 47.49 delivered — lowest item price, loses
  { price: 40.0, shippingPrice: 5.0 }, // 45.00
  { price: 42.75, shippingPrice: 0.0 }, // 42.75 — lowest delivered, WINS
  { price: 42.9, shippingPrice: 0.0 }, // 42.90
  { price: 45.0, shippingPrice: 0.0 }, // 45.00
];

test("picks the lowest delivered-cost listing, not the lowest item price", () => {
  // This is the regression: a naive "lowest item price" would return 39.99.
  assert.equal(pickBuyBoxPrice(SAMPLE_LISTINGS), "42.75");
});

test("a cheap item with expensive shipping never wins the buy box", () => {
  const listings: TcgListing[] = [
    { price: 30.0, shippingPrice: 20.0 }, // 50.00 delivered
    { price: 45.0, shippingPrice: 0.0 }, // 45.00 delivered — wins
  ];
  assert.equal(pickBuyBoxPrice(listings), "45.00");
});

test("a cheap item with cheap paid shipping CAN beat a free-shipping listing", () => {
  // This is the case the old free-shipping-only filter got wrong: it would have
  // ignored the $41 + $1 listing and returned the $42.75 free-shipping one.
  const listings: TcgListing[] = [
    { price: 42.75, shippingPrice: 0.0 }, // 42.75 delivered
    { price: 41.0, shippingPrice: 1.0 }, // 42.00 delivered — wins
  ];
  assert.equal(pickBuyBoxPrice(listings), "41.00");
});

test("returns the item price of the winner, not the delivered total", () => {
  const listings: TcgListing[] = [{ price: 41.0, shippingPrice: 1.0 }];
  // Buyer pays 42.00 all-in, but TCGPlayer's headline shows the 41.00 item price.
  assert.equal(pickBuyBoxPrice(listings), "41.00");
});

test("falls back to rankedShippingPrice when shippingPrice is absent", () => {
  const listings: TcgListing[] = [
    { price: 30.0, rankedShippingPrice: 20.0 }, // 50.00
    { price: 45.0, rankedShippingPrice: 0.0 }, // 45.00 — wins
  ];
  assert.equal(pickBuyBoxPrice(listings), "45.00");
});

test("treats a missing shipping field as free shipping", () => {
  const listings: TcgListing[] = [{ price: 50.0 }];
  assert.equal(pickBuyBoxPrice(listings), "50.00");
});

test("parses string-typed prices and shipping from the API", () => {
  const listings: TcgListing[] = [
    { price: "39.99", shippingPrice: "7.50" }, // 47.49
    { price: "42.75", shippingPrice: "0" }, // 42.75 — wins
  ];
  assert.equal(pickBuyBoxPrice(listings), "42.75");
});

test("on a tie in delivered cost, prefers the lower item price", () => {
  const listings: TcgListing[] = [
    { price: 43.0, shippingPrice: 2.0 }, // 45.00, item 43.00
    { price: 40.0, shippingPrice: 5.0 }, // 45.00, item 40.00 — wins on tie
  ];
  assert.equal(pickBuyBoxPrice(listings), "40.00");
});

test("ignores zero, negative, and non-numeric prices", () => {
  const listings: TcgListing[] = [
    { price: 0, shippingPrice: 0 },
    { price: -5, shippingPrice: 0 },
    { price: "sold out" as unknown as string, shippingPrice: 0 },
    { price: 44.0, shippingPrice: 0 }, // only valid listing — wins
  ];
  assert.equal(pickBuyBoxPrice(listings), "44.00");
});

test("returns null when there are no usable listings", () => {
  assert.equal(pickBuyBoxPrice([]), null);
  assert.equal(pickBuyBoxPrice([{ price: 0 }, { price: -1 }]), null);
});

// ─── Listings query ───────────────────────────────────────────────────────────

test("the listings query does not exclude any sellerPrograms", () => {
  // Regression: `exclude: { sellerPrograms: ["Presale"] }` looked like a presale
  // filter but is a SELLER attribute, so it blacklisted every presale-enrolled
  // store. On product 657851 it returned 11 of 26 live listings and hid the two
  // cheapest delivered ones ($41.94 and $41.95 free shipping), so the site printed
  // TCG LOW $39.00 against a real buy box of $41.94.
  const exclude = buildListingsRequestBody().filters.exclude as Record<string, unknown>;
  assert.equal("sellerPrograms" in exclude, false);
});

test("the listings query asks for live, in-stock listings by delivered cost", () => {
  const body = buildListingsRequestBody();
  assert.equal(body.filters.term.sellerStatus, "Live");
  assert.equal(body.filters.range.quantity.gte, 1);
  // Sorting by delivered cost means the buy-box winner is in the first page even
  // when a product has more listings than `size`.
  assert.equal(body.sort.field, "price+shipping");
  assert.ok(body.size >= 50);
});

// Real listing data captured from product 657851 on 2026-09-03, when TCGPlayer's
// buy box read "$41.94, Shipping: Included" across 26 listings.
test("reproduces the live buy box for product 657851", () => {
  const listings: TcgListing[] = [
    { price: 41.94, shippingPrice: 0 }, // 41.94 delivered, WINS (buy box)
    { price: 41.95, shippingPrice: 0 }, // 41.95
    { price: 39.0, shippingPrice: 2.99 }, // 41.99, lowest item price, loses
    { price: 42.99, shippingPrice: 0 }, // 42.99
    { price: 39.0, shippingPrice: 4.99 }, // 43.99
    { price: 42.0, shippingPrice: 5.99 }, // 47.99
  ];
  assert.equal(pickBuyBoxPrice(listings), "41.94");
});
