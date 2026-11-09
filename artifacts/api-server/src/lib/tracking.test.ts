import { test } from "node:test";
import assert from "node:assert/strict";
import { carrierFor, normalizeTracking, trackingUrlFor } from "./tracking";

test("tracking numbers are cleaned up and junk is rejected", () => {
  assert.equal(normalizeTracking(" 9400 1000 0000 0000 0000 00 "), "9400100000000000000000");
  assert.equal(normalizeTracking("1z999-aa1-01234567 84"), "1Z999AA10123456784");
  assert.equal(normalizeTracking(""), null);
  assert.equal(normalizeTracking("abc"), null);
  assert.equal(normalizeTracking("<script>alert(1)</script>"), null);
  assert.equal(normalizeTracking(undefined), null);
  assert.equal(normalizeTracking(["9400100000000000000000"]), null);
});

test("carrier and tracking link follow the number", () => {
  assert.equal(carrierFor("1Z999AA10123456784"), "UPS");
  assert.equal(carrierFor("9400100000000000000000"), "USPS");
  assert.equal(trackingUrlFor("1Z999AA10123456784"), "https://www.ups.com/track?tracknum=1Z999AA10123456784");
  assert.equal(
    trackingUrlFor("9400100000000000000000"),
    "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400100000000000000000",
  );
});
