import { test } from "node:test";
import assert from "node:assert/strict";
import { pasteAddress, shipBody } from "./labelPage";
import type { LabelOrder } from "./fulfilment";

const ORDER: LabelOrder = {
  sessionId: "cs_test_123",
  item: "Sealed MTG pack",
  quantity: 1,
  created: new Date("2026-11-09T12:00:00Z"),
  to: {
    name: "Jordan Rivera",
    street1: "123 Example St",
    street2: "Apt 4",
    city: "Austin",
    state: "TX",
    zip: "78701",
    country: "US",
    phone: "",
    email: "jordan@example.com",
  },
  servicelevelToken: null,
  displayName: "USPS Ground Advantage",
};

test("paste address is what Pirate Ship's Paste address box takes, email last", () => {
  assert.equal(pasteAddress(ORDER), "Jordan Rivera\n123 Example St\nApt 4\nAustin, TX 78701\njordan@example.com");
});

test("ship page offers Pirate Ship and the tracking form, never Shippo", () => {
  const html = shipBody(ORDER, "tok");
  assert.ok(html.includes("Copy address + open Pirate Ship"));
  assert.ok(html.includes('href="https://ship.pirateship.com/ship"'));
  assert.ok(html.includes('action="/api/labels/cs_test_123/shipped"'));
  assert.ok(html.includes('name="tracking"'));
  assert.ok(!/shippo/i.test(html));
  assert.ok(!html.includes("doesn't look like a tracking number"));
  assert.ok(shipBody(ORDER, "tok", true).includes("doesn't look like a tracking number"));
});

test("ship page escapes customer-entered address text", () => {
  const html = shipBody({ ...ORDER, to: { ...ORDER.to, name: "<b>x</b>" } }, "tok");
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
  assert.ok(!html.includes("<b>x</b>"));
});
