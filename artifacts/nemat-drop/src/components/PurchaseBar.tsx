import { useState } from "react";
import QuantitySelector from "./QuantitySelector";
import CountdownTimer from "./CountdownTimer";
import { product as staticProduct } from "@/data/product";
import { useActiveProduct } from "@/hooks/useActiveProduct";

export default function PurchaseBar() {
  const [quantity, setQuantity] = useState(1);
  const dbProduct = useActiveProduct();

  const pricePerUnit = dbProduct ? dbProduct.price / 100 : staticProduct.dropPrice;
  const productId = dbProduct?.id ?? 1;
  const total = (pricePerUnit * quantity).toFixed(2);

  // Compact label for this tight bar: the product's own short title when set,
  // otherwise its full title (which truncates). Never borrow the static mock's
  // short title for a live DB product.
  const shortTitle = dbProduct
    ? (dbProduct.shortTitle || dbProduct.title)
    : (staticProduct.shortTitle || staticProduct.title);
  const expiresAt = dbProduct?.expiresAt ?? staticProduct.dropExpiresAt;

  // Prefer the live TCG figure when the API has one; fall back to static mock.
  const tcgPrice = dbProduct?.tcgMarketPriceCents
    ? dbProduct.tcgMarketPriceCents / 100
    : staticProduct.tcgBestPrice;

  const savingsPercent =
    tcgPrice > pricePerUnit ? ((1 - pricePerUnit / tcgPrice) * 100).toFixed(2) : null;

  const handleAcquire = () => {
    window.location.href = `/checkout?qty=${quantity}&pid=${productId}`;
  };

  return (
    <div className="sticky bottom-0 z-10 border-t border-cyan-400/40 bg-[#0d0d0d]/95 backdrop-blur-sm">
      <div className="flex items-stretch">
        {/* Product — short title only, from lg up. min-w-0 makes this the cell
            that absorbs any tightness: a short title (e.g. TMNT) shows in full,
            while a product with no short title set falls back to the full title
            and truncates here rather than pushing the buy group off-screen. */}
        <div className="hidden lg:flex items-center min-w-0 max-w-[160px] py-3 pr-4 border-r border-white/10">
          <span className="text-[12.5px] text-white truncate leading-tight">{shortTitle}</span>
        </div>

        {/* Countdown — only from 2xl up; it duplicates the hero timer, so it's the
            first thing to drop when the side-by-side panel is tight */}
        {expiresAt && (
          <div className="hidden 2xl:flex flex-col justify-center items-center py-3 px-4 border-r border-white/10">
            <span className="text-[8.5px] uppercase tracking-[0.16em] text-gray-500 whitespace-nowrap">
              Expires in
            </span>
            <span className="mt-[3px]">
              <CountdownTimer targetIso={expiresAt} variant="inline" />
            </span>
          </div>
        )}

        {/* Buy group — total sits next to the controls as one unit, pushed right.
            Tighter gaps on mobile (product + countdown are hidden there) so the
            total, quantity, and ACQUIRE all fit without clipping. */}
        <div className="flex items-center shrink-0 gap-1.5 lg:gap-4 py-3 pl-0 lg:pl-4 ml-auto">
          <div className="flex flex-col items-end">
            <span className="text-[8.5px] uppercase tracking-[0.16em] text-gray-500 whitespace-nowrap">
              Total
            </span>
            <span className="mt-[3px] whitespace-nowrap">
              <span className="text-[15px] font-bold text-white tabular-nums">${total}</span>
              {savingsPercent && (
                <span className="ml-2 hidden xl:inline text-[11px] font-medium text-green-400 tabular-nums">
                  &minus;{savingsPercent}%
                </span>
              )}
            </span>
          </div>
          <QuantitySelector quantity={quantity} onChange={setQuantity} />
          <button
            onClick={handleAcquire}
            className="flex-shrink-0 px-3 lg:px-8 py-3 bg-cyan-400 text-black text-xs font-bold uppercase tracking-[0.2em] lg:tracking-[0.25em] rounded hover:bg-cyan-300 hover:shadow-[0_0_20px_rgba(34,211,238,0.25)] active:bg-cyan-500 transition-all duration-200"
            aria-label="Acquire product"
          >
            Acquire
          </button>
        </div>
      </div>
    </div>
  );
}
