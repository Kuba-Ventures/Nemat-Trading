import { useEffect } from "react";
import { pushDataLayer, type Ecommerce } from "@/lib/analytics";

const API_URL = import.meta.env.VITE_API_URL ?? "";

type SessionLookup = {
  value: number | null;
  currency?: string;
  shipping?: number | null;
  tax?: number | null;
  items?: { item_id: string; item_name: string; price: number | null; quantity: number }[];
};

// Builds the GA4 ecommerce purchase entry. The Stripe session id is both
// ecommerce.transaction_id and event_id: the browser Meta Purchase tag uses
// event_id as its eventID and the server-side Purchase (Conversions API, sent
// from the Stripe webhook) uses the same id, so Meta counts each sale once.
// transaction_id, value and currency are also kept at the top level for the
// Meta Purchase tag that already reads them there.
export function purchaseEntry(sessionId: string, d: SessionLookup | null): Record<string, unknown> {
  const currency = d?.currency ?? "USD";
  const ecommerce: Ecommerce = {
    transaction_id: sessionId,
    currency,
    ...(d?.value != null ? { value: d.value } : {}),
    items: (d?.items ?? []).map((i) => ({
      item_id: i.item_id,
      item_name: i.item_name,
      price: i.price ?? 0,
      quantity: i.quantity,
    })),
  };
  if (d?.shipping != null) ecommerce.shipping = d.shipping;
  if (d?.tax != null) ecommerce.tax = d.tax;
  return {
    event: "purchase",
    event_id: sessionId,
    transaction_id: sessionId,
    currency,
    ...(d?.value != null ? { value: d.value } : {}),
    ecommerce,
  };
}

export default function SuccessPage() {
  // Push a GA4 ecommerce `purchase` into the dataLayer so GTM can fire GA4 and
  // the Meta Purchase with the real order value. Fail-soft by design: if the
  // lookup fails we still push (no value, no items) so the conversion counts.
  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId) return;

    let cancelled = false;
    const push = (d: SessionLookup | null) => {
      if (cancelled) return;
      pushDataLayer({ ecommerce: null });
      pushDataLayer(purchaseEntry(sessionId, d));
    };

    fetch(`${API_URL}/api/checkout/session/${encodeURIComponent(sessionId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: SessionLookup | null) => push(d && d.value != null ? d : null))
      .catch(() => push(null));

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-black text-white px-6 py-10">
      {/* Header */}
      <div className="mx-auto max-w-2xl flex items-center justify-between mb-10">
        <a href="/" className="flex items-center gap-2 text-xs text-gray-500 hover:text-white transition-colors">
          <span>←</span><span>Back</span>
        </a>
        <div className="flex items-center gap-3">
          <img src="/logo-mark.svg" alt="Tommy Top Decker" className="w-10 h-auto block" />
          <div className="flex flex-col">
            <span className="text-[13px] font-bold tracking-[0.16em] uppercase text-[#f4f0e8] leading-none">TommyTopDecker</span>
            <span className="text-[10px] font-bold tracking-[0.3em] uppercase text-[#c85a5a] leading-none mt-[3px]">Trading Cards</span>
          </div>
        </div>
        <div className="w-12" />
      </div>

      <div className="flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="text-5xl mb-6">✓</div>
        <h1 className="text-3xl font-bold text-cyan-400 mb-3">Order Confirmed</h1>
        <p className="text-gray-400 mb-8">
          Your payment was successful. You'll receive a confirmation email shortly.
        </p>
        <a
          href="/"
          className="inline-block rounded bg-cyan-400 px-8 py-3 text-xs font-bold uppercase tracking-[0.25em] text-black hover:bg-cyan-300 transition-colors"
        >
          Back to Shop
        </a>
      </div>
      </div>
    </main>
  );
}
