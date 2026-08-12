import { useEffect } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "";

export default function SuccessPage() {
  // Push a `purchase` event into the dataLayer so GTM can fire the Meta
  // Purchase event with the real order value. Fail-soft by design: if the
  // lookup fails we still push (without value) so the conversion is counted.
  // The Stripe session id doubles as the dedup key (eventID) shared with the
  // Conversions API Gateway's server-side Purchase.
  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId) return;

    let cancelled = false;
    const push = (extra: Record<string, unknown>) => {
      if (cancelled) return;
      const w = window as unknown as { dataLayer?: Record<string, unknown>[] };
      w.dataLayer = w.dataLayer || [];
      w.dataLayer.push({ event: "purchase", transaction_id: sessionId, currency: "USD", ...extra });
    };

    fetch(`${API_URL}/api/checkout/session/${encodeURIComponent(sessionId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => push(d && d.value != null ? { value: d.value, currency: d.currency ?? "USD" } : {}))
      .catch(() => push({}));

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
            <span className="text-[8px] font-bold tracking-[0.3em] uppercase text-[#b03a3a] leading-none mt-[3px]">Trading Cards</span>
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
