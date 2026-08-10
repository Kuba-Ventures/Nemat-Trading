// Meta (Facebook) Pixel: browser-side event tracking.
//
// Fail-soft by design. If VITE_META_PIXEL_ID is not set, every function here is
// a no-op and the site behaves exactly as before. The Purchase event is NOT
// fired from the browser: it is sent server-side from the Stripe webhook (see
// api-server/src/lib/metaCapi.ts), because after Stripe's hosted checkout the
// browser does not reliably return to the success page. The client events here
// cover the top of the funnel (PageView, ViewContent, AddToCart,
// InitiateCheckout) and also seed the _fbp / _fbc cookies that the server reads
// to improve Conversions API match quality.

type FbqParams = Record<string, unknown>;

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
  }
}

const PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID as string | undefined;

let initialized = false;

// Load fbevents.js, initialize the pixel, and fire the first PageView.
// Safe to call repeatedly; only the first call has any effect.
export function initMetaPixel(): void {
  if (initialized || !PIXEL_ID || typeof window === "undefined") return;
  initialized = true;

  // Standard Meta base code, inlined so it only loads when a pixel id is set.
  /* eslint-disable */
  (function (f: any, b: Document, e: string, v: string) {
    if (f.fbq) return;
    const n: any = (f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    });
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    const t = b.createElement(e) as HTMLScriptElement;
    t.async = true;
    t.src = v;
    const s = b.getElementsByTagName(e)[0];
    s.parentNode?.insertBefore(t, s);
  })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
  /* eslint-enable */

  window.fbq?.("init", PIXEL_ID);
  window.fbq?.("track", "PageView");
}

function track(event: string, params?: FbqParams): void {
  if (!PIXEL_ID || typeof window === "undefined" || !window.fbq) return;
  window.fbq("track", event, params ?? {});
}

type ContentInput = {
  valueDollars: number;
  contentIds: Array<string | number>;
  numItems?: number;
};

function contentParams({ valueDollars, contentIds, numItems }: ContentInput): FbqParams {
  const params: FbqParams = {
    currency: "USD",
    value: Number(valueDollars.toFixed(2)),
    content_type: "product",
    content_ids: contentIds.map(String),
  };
  if (numItems != null) params.num_items = numItems;
  return params;
}

export function trackViewContent(input: ContentInput): void {
  track("ViewContent", contentParams(input));
}

export function trackAddToCart(input: ContentInput): void {
  track("AddToCart", contentParams(input));
}

export function trackInitiateCheckout(input: ContentInput): void {
  track("InitiateCheckout", contentParams(input));
}

// Read the _fbp / _fbc cookies the pixel sets, to forward to the server for
// Conversions API matching. Returns empty strings when a cookie is absent.
export function getFbCookies(): { fbp: string; fbc: string } {
  if (typeof document === "undefined") return { fbp: "", fbc: "" };
  const read = (name: string): string => {
    const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : "";
  };
  return { fbp: read("_fbp"), fbc: read("_fbc") };
}
