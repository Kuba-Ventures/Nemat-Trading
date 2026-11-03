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

// Two shapes of tier data exist. The live product's tiers are a share of pulls
// by rarity, built from Scryfall's set list (card counts per rarity), and sum to
// 100. Tiers from the admin re-lock (and the static mock) are a per-pack hit rate
// ("chance a pack contains at least one of this tier") and do not sum to 100.
// The caption follows the data, so neither is labelled as the other. Neither is
// official pack collation.
// The value is shown as an oversized figure; a few tiers are guaranteed (100%)
// or vanishingly rare (<1%), so normalize those to clean headline numerals.
function figure(t: Tier): { main: string; unit: string } {
  if (t.percent >= 100) return { main: "100", unit: "%" };
  if (t.percent < 1) return { main: "<1", unit: "%" };
  return { main: String(Math.round(t.percent)), unit: "%" };
}

export function isShareOfPulls(tiers: Tier[]): boolean {
  const total = tiers.reduce((n, t) => n + (Number(t.percent) || 0), 0);
  return tiers.length > 1 && Math.abs(total - 100) <= 1;
}

export default function PullProbabilityChart() {
  const dbProduct = useActiveProduct();

  const tiers: Tier[] =
    dbProduct?.pullProbabilities && dbProduct.pullProbabilities !== "[]"
      ? JSON.parse(dbProduct.pullProbabilities)
      : (product.pullProbabilities as Tier[]);
  const share = isShareOfPulls(tiers);

  return (
    <section className="py-10 border-t border-white/5">
      <h2 className="text-xl font-semibold text-white tracking-wide mb-1">
        {share ? "Estimated Pulls by Rarity" : "Estimated Pull Rates"}
      </h2>
      <p className="text-xs text-gray-600 mb-8">
        {share
          ? "Estimated share of pulls by rarity."
          : "Estimated chance a single pack contains at least one card of each tier."}{" "}
        Estimated from the Scryfall set list; not official pack collation.
      </p>

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
