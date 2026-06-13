import { useState, Fragment } from "react";
import { product } from "@/data/product";
import { useActiveProduct } from "@/hooks/useActiveProduct";

function ScryfallCard({ scryfallImage, title, featured }: { scryfallImage?: string; title: string; featured: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  if (!scryfallImage || error) {
    return (
      <div className={`w-full aspect-[2.5/3.5] rounded-lg flex items-center justify-center border ${featured ? "border-amber-500/30 bg-gradient-to-b from-amber-950/40 to-black/60" : "border-white/5 bg-white/[0.02]"}`}>
        <div className="flex flex-col items-center gap-2 opacity-30">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-gray-500">
            <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <path d="M9 9H9.01M15 9H15.01M9 15H9.01M15 15H15.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="text-[9px] uppercase tracking-[0.15em] text-gray-600">No Image</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative w-full aspect-[2.5/3.5] rounded-lg overflow-hidden border transition-all duration-300 ${featured ? "border-amber-500/40 shadow-[0_0_24px_rgba(251,191,36,0.15)]" : "border-white/[0.07] hover:border-white/[0.15]"}`}>
      {!loaded && <div className="absolute inset-0 bg-white/[0.04] animate-pulse rounded-lg" />}
      <img src={scryfallImage} alt={title} onLoad={() => setLoaded(true)} onError={() => setError(true)}
        className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`} />
      <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors duration-200" />
    </div>
  );
}

export default function PossiblePullsGrid() {
  const dbProduct = useActiveProduct();

  const possiblePulls: typeof product.possiblePulls =
    dbProduct?.possiblePulls && dbProduct.possiblePulls !== "[]"
      ? JSON.parse(dbProduct.possiblePulls)
      : product.possiblePulls;

  return (
    <section className="py-16 border-t border-white/5">
      <span className="text-[10px] uppercase tracking-[0.3em] text-gray-500 block mb-2">Card Pulls</span>
      <h2 className="text-xl font-semibold text-white tracking-wide mb-2">Possible Pulls</h2>
      <p className="text-xs text-gray-600 mb-10">
        Card images via{" "}
        <a href="https://scryfall.com" target="_blank" rel="noopener noreferrer"
          className="text-gray-500 hover:text-gray-400 underline underline-offset-2 transition-colors">
          Scryfall
        </a>
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
        {(() => {
          // First common/uncommon card marks the break between chase cards and
          // the everyday pulls — render a thin divider before it.
          const breakAt = possiblePulls.findIndex((p) => /\b(un)?common\b/i.test((p as any).subtitle ?? ""));
          return possiblePulls.map((pull, i) => (
          <Fragment key={(pull as any).id ?? i}>
            {i === breakAt && breakAt > 0 && (
              <div className="col-span-full flex items-center gap-3 mt-2">
                <span className="text-[10px] uppercase tracking-[0.2em] text-gray-600 whitespace-nowrap">Also in every pack</span>
                <span className="flex-1 h-px bg-white/10" />
              </div>
            )}
          <div className="flex flex-col gap-2">
            <ScryfallCard scryfallImage={(pull as any).scryfallImage} title={pull.title} featured={pull.featured} />
            <div>
              <p className={`text-sm font-medium leading-tight ${pull.featured ? "text-amber-400" : "text-amber-300/80"}`}>
                {pull.title}
              </p>
              {(pull as any).subtitle && (
                <p className="text-[10px] text-gray-600 mt-0.5 uppercase tracking-wide">{(pull as any).subtitle}</p>
              )}
              <p className="text-xs text-gray-500 mt-0.5">{pull.probability}</p>
            </div>
          </div>
          </Fragment>
          ));
        })()}
      </div>
    </section>
  );
}
