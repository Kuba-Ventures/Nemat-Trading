import { describe, expect, it } from "vitest";
import { countFilters, matchesFilter, shortTracking, type ShippingInfo } from "./adminShipping";

const s = (over: Partial<ShippingInfo>): ShippingInfo => ({
  stage: "to_ship",
  days: 0,
  late: false,
  carrier: null,
  trackingNumber: null,
  trackingUrl: null,
  status: null,
  statusDetail: null,
  location: null,
  labelCreatedAt: null,
  shippedAt: null,
  deliveredAt: null,
  checkedAt: null,
  emailedAt: null,
  ...over,
});

describe("shipping filters", () => {
  it("groups label printed with in transit, and untracked with delivered", () => {
    expect(matchesFilter(s({ stage: "label" }), "transit")).toBe(true);
    expect(matchesFilter(s({ stage: "transit" }), "transit")).toBe(true);
    expect(matchesFilter(s({ stage: "untracked" }), "delivered")).toBe(true);
    expect(matchesFilter(s({ stage: "to_ship" }), "transit")).toBe(false);
  });

  it("needs attention is anything late, whatever its stage", () => {
    expect(matchesFilter(s({ stage: "to_ship", late: true }), "attention")).toBe(true);
    expect(matchesFilter(s({ stage: "problem", late: true }), "attention")).toBe(true);
    expect(matchesFilter(s({ stage: "delivered" }), "attention")).toBe(false);
  });

  it("counts every tile", () => {
    const orders = [
      { shipping: s({ stage: "to_ship", late: true, days: 11 }) },
      { shipping: s({ stage: "transit" }) },
      { shipping: s({ stage: "delivered" }) },
      { shipping: s({ stage: "problem", late: true }) },
    ];
    expect(countFilters(orders)).toEqual({ all: 4, to_ship: 1, transit: 1, delivered: 1, attention: 2 });
  });
});

describe("shortTracking", () => {
  it("shortens long numbers and leaves short ones", () => {
    expect(shortTracking("9400111899223344554412")).toBe("9400 1118 …4412");
    expect(shortTracking("1Z999AA1")).toBe("1Z999AA1");
  });
});
