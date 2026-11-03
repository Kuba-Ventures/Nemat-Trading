// dataLayer events for Google Tag Manager (GTM-TVHXMXW5).
//
// Every ecommerce event uses the GA4 ecommerce shape, so GTM's GA4 Event tags
// can read it with "Send Ecommerce data" and Meta tags can read the same keys
// through Data Layer Variables. Event names:
//
//   virtual_page_view  every page load and every history change
//                      { page_path, page_location, page_title }
//   view_item          drop page shown with the live product
//   begin_checkout     Pay clicked, Stripe session created, just before the redirect
//   purchase           /success, after Stripe confirms the session is paid
//
// Ecommerce events carry { ecommerce: { currency, value, items[] } } and each
// item is { item_id, item_name, price, quantity }. purchase also carries
// ecommerce.transaction_id and a top-level event_id, both the Stripe session
// id, which is the dedup key the server-side Meta Purchase (Conversions API,
// api-server lib/metaCapi.ts) uses as its event_id.

export type DataLayerItem = {
  item_id: string;
  item_name: string;
  price: number;
  quantity: number;
};

export type Ecommerce = {
  currency: string;
  value?: number; // omitted only on a purchase whose total could not be looked up
  items: DataLayerItem[];
  transaction_id?: string;
  coupon?: string;
  shipping?: number;
  tax?: number;
};

type DataLayerWindow = { dataLayer?: Record<string, unknown>[] };

function dataLayer(): Record<string, unknown>[] {
  const w = window as unknown as DataLayerWindow;
  w.dataLayer = w.dataLayer || [];
  return w.dataLayer;
}

export function pushDataLayer(entry: Record<string, unknown>): void {
  try {
    dataLayer().push(entry);
  } catch {
    // Tracking must never break the page.
  }
}

// GA4 recommends clearing the previous ecommerce object first, so keys from an
// earlier event (say, a view_item's items) never leak into the next one.
export function pushEcommerce(event: string, ecommerce: Ecommerce, extra: Record<string, unknown> = {}): void {
  pushDataLayer({ ecommerce: null });
  pushDataLayer({ event, ...extra, ecommerce });
}

export function toMoney(value: number): number {
  return Number(value.toFixed(2));
}

// Same as pushEcommerce, then runs `next` once GTM has processed the event (or
// after `timeoutMs` if GTM is blocked or slow). Used before leaving the page,
// so the tags get a chance to fire before the browser navigates away.
export function pushEcommerceThen(
  event: string,
  ecommerce: Ecommerce,
  next: () => void,
  timeoutMs = 800,
): void {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    next();
  };
  const timer = window.setTimeout(go, timeoutMs);
  pushDataLayer({ ecommerce: null });
  pushDataLayer({
    event,
    ecommerce,
    eventCallback: () => {
      window.clearTimeout(timer);
      go();
    },
    eventTimeout: timeoutMs,
  });
}

let lastPath: string | null = null;

export function pushVirtualPageView(): void {
  const path = window.location.pathname + window.location.search;
  if (path === lastPath) return;
  lastPath = path;
  pushDataLayer({
    event: "virtual_page_view",
    page_path: window.location.pathname,
    page_location: window.location.href,
    page_title: document.title,
  });
}

let tracking = false;

// Call once on load. Pushes a virtual_page_view for the landing page and for
// every later pushState, replaceState (when the path changes) and back/forward
// navigation. Today every route is a full page load, so in practice this is
// one event per page; the history hooks keep it correct if client-side routing
// is added later.
export function trackPageViews(): void {
  if (tracking) return;
  tracking = true;
  pushVirtualPageView();

  const wrap = (method: "pushState" | "replaceState") => {
    const original = window.history[method];
    window.history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      pushVirtualPageView();
      return result;
    };
  };
  wrap("pushState");
  wrap("replaceState");
  window.addEventListener("popstate", pushVirtualPageView);
}

// For tests only.
export function resetAnalyticsForTests(): void {
  lastPath = null;
}
