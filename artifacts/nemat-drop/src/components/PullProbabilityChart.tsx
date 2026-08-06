import { product } from "@/data/product";
import { useActiveProduct } from "@/hooks/useActiveProduct";

type Tier = {
  label: string;
  abbr: string;
  percent: number;
  color: string;
  display?: string;
  perCardPct?: number | null;
};

// Per-pack hit rate ("chance a pack contains ≥1 of this tier") does NOT sum to
// 100 across tiers, so this renders honest per-tier bars rather than a pie.
// The value is shown as an oversized figure; a few tiers are guaranteed (100%)
// or vanishingly rare (<1%), so normalize those to clean headline numerals.
function figure(t: Tier): { main: string; unit: string } {
  if (t.percent >= 100) return { main: "100", unit: "%" };
  if (t.percent < 1) return { main: "<1", unit: "%" };
  return { main: String(Math.round(t.percent)), unit: "%" };
}

export default function PullProbabilityChart() {
  const dbProduct = useActiveProduct();

  const tiers: Tier[] =
    dbProduct?.pullProbabilities && dbProduct.pullProbabilities !== "[]"
      ? JSON.parse(dbProduct.pullProbabilities)
      : (product.pullProbabilities as Tier[]);

  return (
    <section className="py-10 border-t border-white/5">
      <h2 className="text-xl font-semibold text-white tracking-wide mb-1">Pull Probability</h2>
      <p className="text-xs text-gray-600 mb-8">Odds that a single pack contains at least one card of each tier.</p>

      <div className="flex flex-col gap-6 max-w-xl">
        {tiers.map((tier) => {
          const width = Math.max(2, Math.min(100, tier.percent));
          const { main, unit } = figure(tier);
          return (
            <div key={tier.label}>
              {/* Tier name as a colored eyebrow — replaces the abbr chip */}
              <span
                className="block text-[11px] font-semibold uppercase tracking-[0.16em] leading-tight mb-2.5 truncate"
                style={{ color: tier.color }}
              >
                {tier.label}
              </span>
              {/* Bar and headline number share one baseline */}
              <div className="flex items-end gap-3 sm:gap-4">
                <div className="flex-1 min-w-0 h-2.5 rounded-[5px] bg-white/[0.06] overflow-hidden mb-1.5">
                  <div
                    className="h-full rounded-[5px] transition-all duration-700"
                    style={{ width: `${width}%`, backgroundColor: tier.color }}
                  />
                </div>
                <span className="shrink-0 whitespace-nowrap font-mono font-semibold tabular-nums leading-none tracking-tight text-white text-[30px] sm:text-[34px]">
                  {main}
                  <sup className="text-[13px] font-normal text-gray-500 ml-0.5">{unit}</sup>
                </span>
              </div>
              {tier.perCardPct != null && (
                <span className="mt-2 block text-[10px] text-gray-600">
                  any specific card ≈ {tier.perCardPct < 10 ? tier.perCardPct.toFixed(1) : Math.round(tier.perCardPct)}% / pack
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
