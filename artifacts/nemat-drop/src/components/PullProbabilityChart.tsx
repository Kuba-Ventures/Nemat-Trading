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
function tierDisplay(t: Tier): string {
  if (t.display) return t.display;
  if (t.percent >= 100) return "Guaranteed";
  if (t.percent < 1) return "<1%";
  return `~${t.percent}% / pack`;
}

export default function PullProbabilityChart() {
  const dbProduct = useActiveProduct();

  const tiers: Tier[] =
    dbProduct?.pullProbabilities && dbProduct.pullProbabilities !== "[]"
      ? JSON.parse(dbProduct.pullProbabilities)
      : (product.pullProbabilities as Tier[]);

  return (
    <section className="py-16 border-t border-white/5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-[0.3em] text-gray-500">Oracle's Insight</span>
        <div className="flex gap-1.5">
          {["◈", "◇", "◆"].map((icon, i) => (
            <span key={i} className="text-gray-600 text-sm">{icon}</span>
          ))}
        </div>
      </div>
      <h2 className="text-xl font-semibold text-white tracking-wide mb-1">Pull Probability</h2>
      <p className="text-xs text-gray-600 mb-8">Odds that a single pack contains at least one card of each tier.</p>

      <div className="flex flex-col gap-4 max-w-xl">
        {tiers.map((tier) => {
          const width = Math.max(2, Math.min(100, tier.percent));
          return (
            <div key={tier.label} className="flex items-center gap-3">
              <div
                className="w-7 h-7 flex-shrink-0 flex items-center justify-center border text-[10px] font-bold uppercase tracking-wider rounded-sm"
                style={{ borderColor: tier.color, color: tier.color }}
              >
                {tier.abbr}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="text-sm text-white leading-tight truncate">{tier.label}</span>
                  <span className="text-xs text-gray-400 tabular-nums flex-shrink-0">{tierDisplay(tier)}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${width}%`, backgroundColor: tier.color }}
                  />
                </div>
                {tier.perCardPct != null && (
                  <span className="text-[10px] text-gray-600 mt-1 block">
                    any specific card ≈ {tier.perCardPct < 10 ? tier.perCardPct.toFixed(1) : Math.round(tier.perCardPct)}% / pack
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
