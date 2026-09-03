import { useMemo, useState } from "react";
import { product } from "@/data/product";
import { useActiveProduct } from "@/hooks/useActiveProduct";

const API_URL = import.meta.env.VITE_API_URL ?? "";

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

type ShippingRate = {
  rateId: string;
  service: string;
  amountCents: number;
  estimatedDays: number | null;
};

export default function CheckoutPage() {
  const dbProduct = useActiveProduct();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [zip, setZip] = useState("");
  const [ratesLoading, setRatesLoading] = useState(false);
  const [rates, setRates] = useState<ShippingRate[] | null>(null);
  const [selectedRateId, setSelectedRateId] = useState<string | null>(null);

  const { qty, productId } = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const parsedQty = Number(params.get("qty") ?? "1");
    const parsedPid = Number(params.get("pid") ?? "1");
    return {
      qty: Number.isFinite(parsedQty) && parsedQty > 0 ? Math.min(parsedQty, 2) : 1,
      productId: Number.isFinite(parsedPid) && parsedPid > 0 ? parsedPid : 1,
    };
  }, []);

  const unitCents = dbProduct?.price ?? product.dropPrice * 100;
  const itemsCents = unitCents * qty;
  const selectedRate = rates?.find((r) => r.rateId === selectedRateId) ?? null;
  const shippingCents = selectedRate?.amountCents ?? 0;
  const totalCents = itemsCents + shippingCents;

  const handleFetchRates = async () => {
    setError(null);
    setRates(null);
    setSelectedRateId(null);
    if (!/^\d{5}$/.test(zip)) {
      setError("Enter a valid 5-digit US ZIP code");
      return;
    }
    setRatesLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/shipping/rates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, quantity: qty, destinationZip: zip }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not get shipping rates");
      const fetched: ShippingRate[] = data.rates ?? [];
      setRates(fetched);
      if (fetched.length > 0) setSelectedRateId(fetched[0].rateId);
    } catch (err: any) {
      setError(err.message ?? "Shipping lookup failed");
    } finally {
      setRatesLoading(false);
    }
  };

  const handlePay = async () => {
    if (!selectedRateId) {
      setError("Please choose a shipping option");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, quantity: qty, shippingRateId: selectedRateId }),
      });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { throw new Error(`Server error (${res.status}): ${text.slice(0, 200)}`); }
      if (!res.ok) throw new Error(data.error ?? "Checkout failed");
      window.location.href = data.url;
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-black text-white px-6 py-10">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-10">
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
          <div className="w-12" />{/* spacer to centre logo */}
        </div>

        <div className="mb-6 text-[10px] uppercase tracking-[0.3em] text-gray-500">Secure Checkout</div>
        <h1 className="text-3xl font-semibold mb-2">Complete your order</h1>
        <p className="text-sm text-gray-400 mb-8">Protected checkout powered by Stripe. Your payment details are processed securely.</p>

        <div className="grid gap-4 rounded border border-white/10 bg-white/[0.03] p-6">
          {/* Order summary */}
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div>
              <div className="text-xs uppercase tracking-[0.25em] text-gray-500">Item</div>
              <div className="text-white">{dbProduct?.title ?? product.title}</div>
              <div className="text-xs text-gray-500">Qty {qty}</div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-[0.25em] text-gray-500">Subtotal</div>
              <div className="text-xl font-semibold text-white">{money(itemsCents)}</div>
            </div>
          </div>

          {/* ZIP entry */}
          <div className="border-b border-white/10 pb-4">
            <label className="block text-xs uppercase tracking-[0.25em] text-gray-500 mb-2">
              Shipping ZIP
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={5}
                placeholder="ZIP code"
                value={zip}
                onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
                className="flex-1 bg-white/[0.03] border border-white/10 rounded px-4 py-3 text-sm placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
              />
              <button
                onClick={handleFetchRates}
                disabled={ratesLoading || zip.length !== 5}
                className="px-5 py-3 bg-white/[0.06] border border-white/10 text-xs font-bold uppercase tracking-[0.2em] rounded hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {ratesLoading ? "..." : "Get rates"}
              </button>
            </div>
          </div>

          {/* Rate options */}
          {rates && rates.length > 0 && (
            <div className="border-b border-white/10 pb-4">
              <div className="text-xs uppercase tracking-[0.25em] text-gray-500 mb-3">Shipping method</div>
              <div className="flex flex-col gap-2">
                {rates.map((r) => (
                  <label
                    key={r.rateId}
                    className={`flex items-center justify-between gap-3 rounded border px-4 py-3 cursor-pointer transition-colors ${
                      selectedRateId === r.rateId
                        ? "border-cyan-400/60 bg-cyan-400/[0.05]"
                        : "border-white/10 bg-white/[0.02] hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="shipping-rate"
                        value={r.rateId}
                        checked={selectedRateId === r.rateId}
                        onChange={() => setSelectedRateId(r.rateId)}
                        className="accent-cyan-400"
                      />
                      <div>
                        <div className="text-sm text-white">{r.service}</div>
                        {r.estimatedDays !== null && (
                          <div className="text-xs text-gray-500">
                            ~{r.estimatedDays} day{r.estimatedDays === 1 ? "" : "s"}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-white">{money(r.amountCents)}</div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Total */}
          {selectedRate && (
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="text-xs uppercase tracking-[0.25em] text-gray-500">Total</div>
              <div className="text-2xl font-bold text-cyan-400">{money(totalCents)}</div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded px-4 py-3">
              {error}
            </p>
          )}

          <button
            onClick={handlePay}
            disabled={loading || !selectedRateId}
            className="rounded bg-cyan-400 px-5 py-3 text-xs font-bold uppercase tracking-[0.25em] text-black hover:bg-cyan-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Redirecting..." : "Pay securely with Stripe"}
          </button>

          <p className="text-xs text-gray-500">
            You'll be redirected to Stripe's secure payment page.
          </p>
        </div>
      </div>
    </main>
  );
}
