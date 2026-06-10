/**
 * TCGPlayer buy-box price selection.
 *
 * TCGPlayer's product page shows a single "promoted listing" in its buy box, and
 * that headline number is the one we mirror as our "TCG LOW" price. The buy box is
 * won by the listing with the lowest *delivered* cost — item price + shipping — NOT
 * the lowest item price. A $39.99 card with $7.50 shipping ($47.49 delivered) loses
 * to a $42.75 card with free shipping. The headline then displays the winning
 * listing's *item* price (shipping is shown separately, "included" when free).
 *
 * Keeping this as a standalone pure function means it can be regression-tested
 * without any network calls — see tcg-pricing.test.ts.
 */

/** A single active listing as returned by TCGPlayer's mp-search-api listings endpoint. */
export interface TcgListing {
  price?: number | string;
  /** Per-listing shipping cost. 0 means "shipping: included" on TCGPlayer. */
  shippingPrice?: number | string;
  /** Fallback shipping field some responses use instead of shippingPrice. */
  rankedShippingPrice?: number | string;
}

function toNumber(v: unknown): number {
  return typeof v === "number" ? v : parseFloat(v as string);
}

/**
 * Pick the price TCGPlayer prints in its buy-box headline from a list of active
 * listings. Returns that listing's item price formatted to 2 decimals, or null if
 * no listing has a usable positive price.
 *
 * Selection rule: minimize (item price + shipping); on a tie, prefer the lower item
 * price. The input order does not matter — every listing is considered.
 */
export function pickBuyBoxPrice(listings: TcgListing[]): string | null {
  let best: { price: number; total: number } | null = null;
  for (const item of listings) {
    const price = toNumber(item.price);
    if (isNaN(price) || price <= 0) continue;
    const ship = toNumber(item.shippingPrice ?? item.rankedShippingPrice);
    const total = price + (isNaN(ship) ? 0 : ship);
    // Lowest delivered total wins; on a tie, the lower item price wins. Tie-break is
    // explicit (not reliant on input order) so the result is order-independent.
    if (!best || total < best.total || (total === best.total && price < best.price)) {
      best = { price, total };
    }
  }
  return best ? best.price.toFixed(2) : null;
}
