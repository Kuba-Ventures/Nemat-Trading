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

  const title = dbProduct?.title ?? staticProduct.title;
  const subtitle = dbProduct?.subtitle ?? staticProduct.subtitle;
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
        {/* Product — desktop only; on mobile the hero is already in view */}
        <div className="hidden md:flex flex-col justify-center min-w-0 max-w-[240px] py-3 pr-4 border-r border-white/10">
          <span className="text-[12.5px] text-white truncate leading-tight">{title}</span>
          <span className="text-[8.5px] uppercase tracking-[0.16em] text-gray-500 mt-[3px] truncate">
            {subtitle}
          </span>
        </div>

        {/* Countdown */}
        {expiresAt && (
          <div className="hidden sm:flex flex-col justify-center items-center py-3 px-4 border-r border-white/10">
            <span className="text-[8.5px] uppercase tracking-[0.16em] text-gray-500 whitespace-nowrap">
              Expires in
            </span>
            <span className="mt-[3px]">
              <CountdownTimer targetIso={expiresAt} variant="inline" />
            </span>
          </div>
        )}

        {/* Total */}
        <div className="flex-1 min-w-0 flex flex-col justify-center items-end sm:items-center py-3 px-4">
          <span className="text-[8.5px] uppercase tracking-[0.16em] text-gray-500 whitespace-nowrap">
            Total
          </span>
          <span className="mt-[3px] whitespace-nowrap">
            <span className="text-[15px] font-bold text-white tabular-nums">${total}</span>
            {savingsPercent && (
              <span className="ml-2 text-[11px] font-medium text-green-400 tabular-nums">
                &minus;{savingsPercent}%
              </span>
            )}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 py-3 pl-4">
          <QuantitySelector quantity={quantity} onChange={setQuantity} />
          <button
            onClick={handleAcquire}
            className="flex-shrink-0 px-6 md:px-8 py-3 bg-cyan-400 text-black text-xs font-bold uppercase tracking-[0.25em] rounded hover:bg-cyan-300 hover:shadow-[0_0_20px_rgba(34,211,238,0.25)] active:bg-cyan-500 transition-all duration-200"
            aria-label="Acquire product"
          >
            Acquire
          </button>
        </div>
      </div>
    </div>
  );
}
