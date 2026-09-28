import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "";

type Order = {
  value: number | null;
  currency: string;
  orderId: string;
  quantity: number;
  subtotal: number;
  shipping: number;
  tax: number;
  shipTo: { name: string; line1: string; line2: string; city: string; state: string; zip: string } | null;
  pack: { title: string; shortTitle: string; subtitle: string; imageUrl: string } | null;
};

const money = (n: number) => `$${n.toFixed(2)}`;

export default function SuccessPage() {
  const [order, setOrder] = useState<Order | null>(null);

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
      .then((d: Order | null) => {
        push(d && d.value != null ? { value: d.value, currency: d.currency ?? "USD" } : {});
        if (d && !cancelled) setOrder(d);
      })
      .catch(() => push({}));

    return () => {
      cancelled = true;
    };
  }, []);

  const qty = order?.quantity ?? 1;
  const packName = order?.pack ? order.pack.shortTitle || order.pack.title : "";
  const itemLabel = order?.pack
    ? `${packName}${order.pack.subtitle ? ` ${order.pack.subtitle}` : ""}`
    : "Your order";
  const ship = order?.shipTo;
  const locality = ship ? [ship.city, ship.state].filter(Boolean).join(", ") : "";
  const cityLine = ship ? [locality, ship.zip].filter(Boolean).join(" ") : "";
  const orderRef = order?.orderId.slice(-8).toUpperCase();

  return (
    <main className="min-h-screen bg-black text-white px-6 py-10 bg-[radial-gradient(circle_at_50%_22%,rgba(34,211,238,0.14)_0,#000_55%)]">
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

      <div className="mx-auto max-w-md text-center">
        <p className="text-[11px] font-bold tracking-[0.3em] uppercase text-[#c85a5a]">Order Confirmed</p>
        <h1 className="mt-3 mb-6 font-['Gotham_Black'] text-4xl sm:text-5xl leading-[1.02] uppercase text-[#f4f0e8]">
          Locked in.
          {order?.pack && (
            <>
              <br />
              {qty} {packName} {qty === 1 ? "pack is" : "packs are"} yours.
            </>
          )}
        </h1>

        {order?.pack?.imageUrl && (
          <img
            src={order.pack.imageUrl}
            alt={order.pack.title}
            className="mx-auto w-44 sm:w-52 -rotate-6 drop-shadow-[0_0_40px_rgba(34,211,238,0.35)]"
          />
        )}

        {/* Order status */}
        <ol className="mt-8 flex gap-1 text-[10px] font-bold tracking-[0.12em] uppercase">
          {["Confirmed", "Packed", "Shipped"].map((step, i) => (
            <li
              key={step}
              className={`flex-1 border-t-[3px] pt-2 ${i === 0 ? "border-cyan-400 text-cyan-400" : "border-gray-800 text-gray-600"}`}
            >
              {step}
            </li>
          ))}
        </ol>

        {order && (
          <div className="mt-6 text-left">
            <section className="border-t border-gray-800 py-4">
              <p className="mb-2 text-[10px] tracking-[0.14em] uppercase text-gray-500">Order #{orderRef}</p>
              <div className="flex justify-between py-0.5 text-sm">
                <span className="text-gray-400">{itemLabel} ×{qty}</span>
                <span>{money(order.subtotal)}</span>
              </div>
              <div className="flex justify-between py-0.5 text-sm">
                <span className="text-gray-400">Shipping</span>
                <span>{money(order.shipping)}</span>
              </div>
              <div className="flex justify-between py-0.5 text-sm">
                <span className="text-gray-400">Tax</span>
                <span>{money(order.tax)}</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-gray-800 pt-2 text-sm font-bold">
                <span>Total paid</span>
                <span>{order.value != null ? money(order.value) : ""}</span>
              </div>
            </section>

            {ship && (
              <section className="border-t border-gray-800 py-4">
                <p className="mb-2 text-[10px] tracking-[0.14em] uppercase text-gray-500">Shipping to</p>
                <p className="text-sm leading-relaxed">
                  {[ship.name, ship.line1, ship.line2, cityLine].filter(Boolean).map((line) => (
                    <span key={line} className="block">{line}</span>
                  ))}
                </p>
              </section>
            )}
          </div>
        )}

        <p className="mt-4 mb-8 text-xs text-gray-400">
          A confirmation email is on its way. We'll email tracking as soon as it ships.
        </p>
        <a
          href="/"
          className="inline-block rounded bg-cyan-400 px-8 py-3 text-xs font-bold uppercase tracking-[0.25em] text-black hover:bg-cyan-300 transition-colors"
        >
          Back to Shop
        </a>
      </div>
    </main>
  );
}
