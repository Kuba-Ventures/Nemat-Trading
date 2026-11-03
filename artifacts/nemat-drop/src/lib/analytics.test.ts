import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pushEcommerce, pushEcommerceThen, pushVirtualPageView, resetAnalyticsForTests, trackPageViews } from "./analytics";
import { purchaseEntry } from "@/pages/success";

type W = { dataLayer?: Record<string, unknown>[] };
const dl = () => (window as unknown as W).dataLayer ?? [];

beforeEach(() => {
  (window as unknown as W).dataLayer = [];
  resetAnalyticsForTests();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.useRealTimers();
});

const item = { item_id: "7", item_name: "TMNT Collector Booster", price: 32, quantity: 2 };

describe("ecommerce events", () => {
  it("clears the previous ecommerce object, then pushes the GA4 shape", () => {
    pushEcommerce("view_item", { currency: "USD", value: 32, items: [{ ...item, quantity: 1 }] });
    expect(dl()).toEqual([
      { ecommerce: null },
      { event: "view_item", ecommerce: { currency: "USD", value: 32, items: [{ ...item, quantity: 1 }] } },
    ]);
  });

  it("begin_checkout runs the redirect when GTM calls back", () => {
    const next = vi.fn();
    pushEcommerceThen("begin_checkout", { currency: "USD", value: 64, items: [item] }, next);
    const entry = dl()[1] as { event: string; eventCallback: () => void };
    expect(entry.event).toBe("begin_checkout");
    entry.eventCallback();
    entry.eventCallback();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("begin_checkout still redirects if GTM never loads", () => {
    vi.useFakeTimers();
    const next = vi.fn();
    pushEcommerceThen("begin_checkout", { currency: "USD", value: 64, items: [item] }, next, 500);
    expect(next).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("purchase", () => {
  it("uses the Stripe session id as transaction_id and event_id", () => {
    const entry = purchaseEntry("cs_live_abc", {
      value: 43.07,
      currency: "USD",
      shipping: 5.25,
      tax: 2.82,
      items: [{ ...item, price: 32, quantity: 1 }],
    });
    expect(entry).toEqual({
      event: "purchase",
      event_id: "cs_live_abc",
      transaction_id: "cs_live_abc",
      currency: "USD",
      value: 43.07,
      ecommerce: {
        transaction_id: "cs_live_abc",
        currency: "USD",
        value: 43.07,
        shipping: 5.25,
        tax: 2.82,
        items: [{ ...item, price: 32, quantity: 1 }],
      },
    });
  });

  it("still pushes, without a value, when the lookup fails", () => {
    const entry = purchaseEntry("cs_live_abc", null) as { ecommerce: Record<string, unknown> };
    expect(entry).not.toHaveProperty("value");
    expect(entry.ecommerce).toEqual({ transaction_id: "cs_live_abc", currency: "USD", items: [] });
  });
});

describe("virtual_page_view", () => {
  it("pushes once per distinct path, including history changes", () => {
    trackPageViews();
    window.history.pushState(null, "", "/past-drops");
    window.history.replaceState(null, "", "/past-drops");
    window.history.pushState(null, "", "/how-it-works");
    pushVirtualPageView();
    const paths = dl().filter((e) => e.event === "virtual_page_view").map((e) => e.page_path);
    expect(paths).toEqual(["/", "/past-drops", "/how-it-works"]);
  });
});
