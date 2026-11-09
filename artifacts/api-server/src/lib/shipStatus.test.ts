import { test } from "node:test";
import assert from "node:assert/strict";
import { emailStage, parseShippoTrack, shipStage, shipTiming, shippoCarrier, type ShipRow } from "./shipStatus";

test("Shippo track: delivered package gets shipped and delivered dates", () => {
  const u = parseShippoTrack({
    tracking_status: {
      status: "DELIVERED",
      status_details: "Delivered, Front Door/Porch",
      status_date: "2026-11-02T18:04:00Z",
      location: { city: "Austin", state: "TX", zip: "78701" },
    },
    tracking_history: [
      { status: "PRE_TRANSIT", status_date: "2026-10-22T15:00:00Z" },
      { status: "TRANSIT", status_date: "2026-10-23T02:10:00Z" },
      { status: "TRANSIT", status_date: "2026-10-27T09:00:00Z" },
      { status: "DELIVERED", status_date: "2026-11-02T18:04:00Z" },
    ],
  });
  assert.equal(u.status, "DELIVERED");
  assert.equal(u.statusDetail, "Delivered, Front Door/Porch");
  assert.equal(u.location, "Austin, TX");
  assert.equal(u.shippedAt?.toISOString(), "2026-10-23T02:10:00.000Z");
  assert.equal(u.deliveredAt?.toISOString(), "2026-11-02T18:04:00.000Z");
});

test("Shippo track: label only, nothing scanned yet", () => {
  const u = parseShippoTrack({
    tracking_status: { status: "PRE_TRANSIT", status_details: "Label created", status_date: "2026-11-09T20:00:00Z", location: null },
    tracking_history: [{ status: "PRE_TRANSIT", status_date: "2026-11-09T20:00:00Z" }],
  });
  assert.equal(u.status, "PRE_TRANSIT");
  assert.equal(u.shippedAt, null);
  assert.equal(u.deliveredAt, null);
  assert.equal(u.location, null);
});

test("Shippo track: junk and unknown statuses don't throw", () => {
  assert.deepEqual(parseShippoTrack(null), { status: "UNKNOWN", statusDetail: null, location: null, shippedAt: null, deliveredAt: null });
  assert.equal(parseShippoTrack({ tracking_status: { status: "WEIRD" } }).status, "UNKNOWN");
  assert.equal(parseShippoTrack({ tracking_status: { status: "TRANSIT", status_date: "not a date" } }).shippedAt, null);
});

const base: ShipRow = {
  createdAt: new Date("2026-10-29T01:13:55Z"),
  trackingNumber: null,
  shippedElsewhere: false,
  trackingStatus: null,
  labelCreatedAt: null,
  shippedAt: null,
};
const now = new Date("2026-11-09T22:00:00Z");

test("stages follow tracking and carrier status", () => {
  assert.equal(shipStage(base), "to_ship");
  assert.equal(shipStage({ ...base, shippedElsewhere: true }), "untracked");
  assert.equal(shipStage({ ...base, trackingNumber: "9400", trackingStatus: null }), "label");
  assert.equal(shipStage({ ...base, trackingNumber: "9400", trackingStatus: "PRE_TRANSIT" }), "label");
  assert.equal(shipStage({ ...base, trackingNumber: "9400", trackingStatus: "TRANSIT" }), "transit");
  assert.equal(shipStage({ ...base, trackingNumber: "9400", trackingStatus: "DELIVERED" }), "delivered");
  assert.equal(shipStage({ ...base, trackingNumber: "9400", trackingStatus: "RETURNED" }), "problem");
  assert.equal(shipStage({ ...base, trackingNumber: "9400", trackingStatus: "FAILURE" }), "problem");
});

test("late rules: 3 days to ship, 7 days in transit, problems always", () => {
  // Luis's order: 11 days, no tracking.
  assert.deepEqual(shipTiming(base, now), { stage: "to_ship", days: 11, late: true });
  assert.equal(shipTiming({ ...base, createdAt: new Date("2026-11-07T22:00:00Z") }, now).late, false);
  // Label printed 5 days ago, never scanned.
  assert.equal(shipTiming({ ...base, trackingNumber: "9400", labelCreatedAt: new Date("2026-11-04T22:00:00Z") }, now).late, true);
  // In transit 6 days: fine. 9 days: late.
  const transit = { ...base, trackingNumber: "9400", trackingStatus: "TRANSIT" };
  assert.equal(shipTiming({ ...transit, shippedAt: new Date("2026-11-03T21:00:00Z") }, now).late, false);
  assert.equal(shipTiming({ ...transit, shippedAt: new Date("2026-10-31T21:00:00Z") }, now).late, true);
  assert.equal(shipTiming({ ...base, trackingNumber: "9400", trackingStatus: "RETURNED" }, now).late, true);
  assert.deepEqual(shipTiming({ ...base, trackingNumber: "9400", trackingStatus: "DELIVERED" }, now), { stage: "delivered", days: 0, late: false });
  assert.equal(shipTiming({ ...base, shippedElsewhere: true }, now).late, false);
});

test("Shippo carrier token", () => {
  assert.equal(shippoCarrier("1Z999AA10123456784"), "ups");
  assert.equal(shippoCarrier("9400100000000000000000"), "usps");
});

test("email stage is the furthest stage reached", () => {
  const r = { trackingNumber: null as string | null, trackingStatus: null as string | null, shippedAt: null as Date | null, deliveredAt: null as Date | null };
  assert.equal(emailStage(r), null);
  assert.equal(emailStage({ ...r, trackingNumber: "9400" }), "packed");
  assert.equal(emailStage({ ...r, trackingNumber: "9400", trackingStatus: "PRE_TRANSIT" }), "packed");
  assert.equal(emailStage({ ...r, trackingNumber: "9400", trackingStatus: "TRANSIT" }), "shipped");
  assert.equal(emailStage({ ...r, trackingNumber: "9400", shippedAt: new Date() }), "shipped");
  assert.equal(emailStage({ ...r, trackingNumber: "9400", trackingStatus: "DELIVERED" }), "delivered");
});
