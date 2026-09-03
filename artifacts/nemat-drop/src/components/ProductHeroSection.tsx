import { product as staticProduct } from "@/data/product";
import { useActiveProduct } from "@/hooks/useActiveProduct";
import { useTcgPrice } from "@/hooks/useTcgPrice";
import { useTimeLeft, pad } from "@/lib/countdown";

function DealCountdown({ expiresAt }: { expiresAt: string }) {
  const time = useTimeLeft(expiresAt);

  // Drops run a 10-day window, which does not fit an HH:MM:SS clock: it used to
  // read "160" in the HRS slot. Past 24 hours the units shift up to days, and
  // seconds come back for the final day, where they carry real urgency.
  const units = time.isLong
    ? [{ v: time.d, l: "DAYS" }, { v: time.h, l: "HRS" }, { v: time.m, l: "MIN" }]
    : [{ v: time.h, l: "HRS" }, { v: time.m, l: "MIN" }, { v: time.s, l: "SEC" }];

  if (time.done) return (
    <div className="border border-white/[0.06] rounded bg-white/[0.02] px-6 py-4 flex w-fit mx-auto items-center justify-center mb-8">
      <span className="text-[10px] uppercase tracking-[0.25em] text-gray-500">Deal Expired</span>
    </div>
  );

  return (
    <div className="border border-white/[0.06] rounded bg-white/[0.02] px-6 py-4 flex w-fit mx-auto flex-col items-center justify-center mb-8">
      <span className="text-[10px] uppercase tracking-[0.25em] text-gray-500 mb-3">Deal Expires In</span>
      <div className="flex items-end gap-1">
        {units.map((unit, i) => (
          <div key={unit.l} className="flex items-end">
            <div className="flex flex-col items-center">
              <span className="text-2xl md:text-3xl font-mono font-bold text-cyan-400 tracking-widest tabular-nums">{pad(unit.v)}</span>
              <span className="text-[9px] uppercase tracking-[0.2em] text-gray-500 mt-0.5">{unit.l}</span>
            </div>
            {i < 2 && <span className="text-xl font-mono text-cyan-400/60 mx-0.5 mb-4">:</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ProductHeroSection() {
  const dbProduct = useActiveProduct();
  const tcg = useTcgPrice();

  const title = dbProduct?.title ?? staticProduct.title;
  const subtitle = dbProduct?.subtitle ?? staticProduct.subtitle;

  // Nemat price is FIXED — always the stored DB price, never fluctuates with TCG
  const nematPrice = dbProduct ? dbProduct.price / 100 : staticProduct.dropPrice;

  // No TCG figure means no comparison: the strip collapses to the drop price
  // rather than quoting a placeholder as if it were TCGPlayer's number.
  const tcgBest = tcg.status === "ready" ? tcg.price : null;

  // Savings calculated dynamically: how much cheaper are we vs current TCG price
  const savings = tcgBest !== null && tcgBest > nematPrice
    ? parseFloat(((1 - nematPrice / tcgBest) * 100).toFixed(2))
    : 0;

  // Keep the cells (as skeletons) while the fetch is in flight, drop them for good
  // once we know there is no number coming.
  const showCompare = tcg.status !== "unavailable";

  return (
    <section className="pb-10">
      {/* The status pill doubles as a discreet admin entry (also reachable at /admin). */}
      <a href="/admin" aria-label="Admin" className="flex items-center mb-6 w-fit group">
        <span className="text-[10px] uppercase tracking-[0.3em] text-gray-500 group-hover:text-gray-300 transition-colors">{staticProduct.status}</span>
      </a>

      <h1 className="text-3xl md:text-4xl font-bold text-white leading-tight tracking-tight mb-1">{title}</h1>
      <p className="text-base text-gray-500 uppercase tracking-[0.2em] mb-8">{subtitle}</p>

      {dbProduct?.expiresAt && <DealCountdown expiresAt={dbProduct.expiresAt} />}

      {/* Comparison strip. With no TCG figure the whole comparison drops out and
          the drop price gets the full width: better an honest single number than
          a dash pretending to be TCGPlayer's price. */}
      <div className={`grid ${showCompare ? "grid-cols-3" : "grid-cols-1"} gap-0 border border-white/[0.06] rounded overflow-hidden mb-2`}>
        {showCompare && (
          <div className="flex flex-col items-center justify-center py-4 px-3 border-r border-white/[0.06]">
            {dbProduct?.tcgplayerUrl ? (
              <a href={dbProduct.tcgplayerUrl} target="_blank" rel="noopener noreferrer"
                className="text-[9px] uppercase tracking-[0.2em] text-gray-600 hover:text-cyan-600 transition-colors mb-1 underline underline-offset-2">
                TCG Low ↗
              </a>
            ) : (
              <span className="text-[9px] uppercase tracking-[0.2em] text-gray-600 mb-1">TCG Low</span>
            )}
            {tcgBest === null ? (
              <span role="status" aria-label="Loading TCGPlayer price"
                className="h-4 w-16 rounded bg-white/10 animate-pulse" />
            ) : (
              <span className="text-base text-gray-500 line-through">${tcgBest.toFixed(2)}</span>
            )}
            {tcg.live && <span className="text-[8px] text-cyan-600 mt-0.5">Live</span>}
          </div>
        )}
        <div className={`flex flex-col items-center justify-center py-4 px-3 bg-cyan-400/[0.05] ${showCompare ? "border-r border-white/[0.06]" : ""}`}>
          <span className="text-[9px] uppercase tracking-[0.2em] text-cyan-400 mb-1">Today's Drop</span>
          <span className="text-xl font-bold text-cyan-400">${nematPrice.toFixed(2)}</span>
        </div>
        {showCompare && (
          <div className="flex flex-col items-center justify-center py-4 px-3">
            <span className="text-[9px] uppercase tracking-[0.2em] text-green-400 mb-1">You Save</span>
            {tcgBest === null ? (
              <span role="status" aria-label="Calculating savings"
                className="h-4 w-11 rounded bg-white/10 animate-pulse" />
            ) : (
              <span className="text-base font-semibold text-green-400">{savings.toFixed(2)}%</span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
