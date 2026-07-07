import { Router } from "express";
import { pickBuyBoxPrice } from "../lib/tcg-pricing";

const router = Router();

function requireAdmin(req: any, res: any, next: any) {
  const key = req.headers["x-admin-key"];
  if (!process.env.ADMIN_SECRET || key !== process.env.ADMIN_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Scryfall now requires a User-Agent + Accept header on every API request and
// returns HTTP 400 without them. Route all Scryfall calls through this helper.
function scryfallFetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: { "User-Agent": "NematTrading/1.0", Accept: "application/json" },
  });
}

function titleCase(s: string) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function dedupeWords(s: string): string {
  const words = s.trim().split(/\s+/);
  if (words.length < 4) return s;
  const half = Math.floor(words.length / 2);
  const first = words.slice(0, half).join(" ");
  const second = words.slice(half).join(" ");
  if (first === second) return first;
  if (second.startsWith(first)) return first;
  return s;
}

/** Recursively search a JSON object for a positive numeric price value at known keys */
function findPriceInJson(obj: unknown, depth = 0): string | null {
  if (depth > 6 || !obj || typeof obj !== "object") return null;
  // Use lowest active listing price — matches TCGPlayer's "as low as" displayed price
  const PRICE_KEYS = ["lowestListingPrice", "lowestPrice", "directLowPrice", "lowPrice", "marketPrice"];
  for (const key of PRICE_KEYS) {
    const val = (obj as any)[key];
    const n = typeof val === "number" ? val : parseFloat(val);
    if (!isNaN(n) && n > 0) return n.toFixed(2);
  }
  for (const value of Object.values(obj as object)) {
    const found = findPriceInJson(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Get product image + lowest price from a TCGPlayer URL.
 *
 * Strategy:
 *  1. Image — construct directly from product ID via TCGPlayer's CDN (no HTTP fetch needed)
 *  2. Price — try mpapi.tcgplayer.com marketplace endpoint (often public)
 *  3. Price fallback — scrape the product page and search __NEXT_DATA__ / JSON-LD
 */
async function scrapeTCGPlayer(url: string): Promise<{ imageUrl: string | null; lowestPrice: string | null }> {
  // Extract numeric product ID from URL  e.g. /product/657851/...
  const productIdMatch = url.match(/\/product\/(\d+)\//);
  const productId = productIdMatch?.[1] ?? null;

  // 1. Construct image URL from TCGPlayer CDN (no scraping, no Cloudflare)
  const imageUrl = productId
    ? `https://product-images.tcgplayer.com/fit-in/437x437/${productId}.jpg`
    : null;

  let lowestPrice: string | null = null;

  const mpHeaders = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.tcgplayer.com/",
    "Origin": "https://www.tcgplayer.com",
    "Accept": "application/json, text/plain, */*",
  };

  // TCGPlayer is fully client-side rendered — HTML scraping cannot get live prices.
  // Strategy: use mp-search-api POST endpoint which returns real active listings
  // sorted by price ascending, excluding presale listings.
  if (productId) {
    // 1. Search API — fetch listings sorted by price, presale excluded.
    //    Match TCGPlayer's headline "promoted listing" price: the buy box is won
    //    by the listing with the lowest all-in cost (item price + shipping), NOT the
    //    lowest item price. We pick that listing and report its item price — the exact
    //    number shown in TCGPlayer's buy box headline (with "shipping: included" when free).
    try {
      const searchRes = await fetch(
        `https://mp-search-api.tcgplayer.com/v1/product/${productId}/listings`,
        {
          method: "POST",
          headers: { ...mpHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({
            filters: {
              term: { sellerStatus: "Live", channelId: 0 },
              range: { quantity: { gte: 1 } },
              exclude: { channelExclusion: 0, sellerPrograms: ["Presale"] },
            },
            from: 0,
            size: 30,
            sort: { field: "price", order: "asc" },
            context: { shippingCountry: "US", cart: {} },
          }),
        }
      );
      if (searchRes.ok) {
        const searchData = await searchRes.json() as any;
        const results: any[] = searchData?.results?.[0]?.results ?? [];
        // Match TCGPlayer's headline by picking the buy-box winner (lowest
        // delivered cost). Logic lives in pickBuyBoxPrice so it can be unit-tested.
        lowestPrice = pickBuyBoxPrice(results) ?? lowestPrice;
      }
    } catch {}

    // 2. Pricepoints fallback — market average if search API fails
    if (!lowestPrice) {
      try {
        const ppRes = await fetch(
          `https://mpapi.tcgplayer.com/v2/product/${productId}/pricepoints?mpfev=2`,
          { headers: mpHeaders }
        );
        if (ppRes.ok) {
          lowestPrice = findPriceInJson(await ppRes.json());
        }
      } catch {}
    }
  }

  return { imageUrl, lowestPrice };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Proxy Scryfall price by card ID
router.get("/scryfall/:id/price", async (req, res) => {
  const { id } = req.params;
  try {
    const response = await scryfallFetch(`https://api.scryfall.com/cards/${id}`);
    if (!response.ok) { res.json({ usd: null }); return; }
    const data = await response.json() as { prices?: { usd?: string | null } };
    res.json({ usd: data.prices?.usd ?? null });
  } catch {
    res.json({ usd: null });
  }
});

// Live refresh: fetch current lowest price from a TCGPlayer product URL
router.post("/tcgplayer/price", async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url) { res.status(400).json({ error: "url required" }); return; }
  const { lowestPrice } = await scrapeTCGPlayer(url);
  res.json({ lowestPrice });
});

// GET version for easy browser testing: /api/tcgplayer/price-check?id=657851
router.get("/tcgplayer/price-check", async (req, res) => {
  const id = req.query.id as string;
  if (!id) { res.status(400).json({ error: "id query param required" }); return; }
  const url = `https://www.tcgplayer.com/product/${id}/product`;
  const result = await scrapeTCGPlayer(url);
  res.json(result);
});

// Debug: dump raw responses from TCGPlayer APIs — /api/tcgplayer/debug?id=657851
router.get("/tcgplayer/debug", async (req, res) => {
  const id = req.query.id as string;
  if (!id) { res.status(400).json({ error: "id required" }); return; }
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.tcgplayer.com/",
    "Origin": "https://www.tcgplayer.com",
    "Accept": "application/json, text/plain, */*",
  };
  const results: Record<string, any> = {};
  try {
    const r = await fetch(`https://mpapi.tcgplayer.com/v2/product/${id}/listings?mpfev=2&limit=10&offset=0`, { headers });
    results.listings = { status: r.status, body: await r.json() };
  } catch (e: any) { results.listings = { error: e.message }; }
  try {
    const r = await fetch(`https://mpapi.tcgplayer.com/v2/product/${id}/pricepoints?mpfev=2`, { headers });
    results.pricepoints = { status: r.status, body: await r.json() };
  } catch (e: any) { results.pricepoints = { error: e.message }; }
  try {
    const r = await fetch(`https://mpapi.tcgplayer.com/v2/product/${id}/extendeddata?mpfev=2`, { headers });
    results.extendeddata = { status: r.status, body: await r.json() };
  } catch (e: any) { results.extendeddata = { error: e.message }; }
  try {
    const r = await fetch(`https://mpapi.tcgplayer.com/v2/product/${id}?mpfev=2`, { headers });
    results.productDetails = { status: r.status, body: await r.json() };
  } catch (e: any) { results.productDetails = { error: e.message }; }
  // Check what the HTML page returns (Cloudflare block check)
  try {
    const r = await fetch(`https://www.tcgplayer.com/product/${id}/`, {
      headers: { ...headers, "Accept": "text/html,application/xhtml+xml", "Referer": "https://www.google.com/" },
      redirect: "follow",
    });
    const html = await r.text();
    const asLowAs = html.match(/as\s+low\s+as\s+\$?([\d]+\.[\d]{2})/i);
    const cfBlocked = html.includes("Just a moment") || html.includes("cf-browser-verification") || html.includes("challenge-platform");
    results.htmlScrape = {
      status: r.status,
      cloudflareBlocked: cfBlocked,
      asLowAsMatch: asLowAs?.[1] ?? null,
      htmlSnippet: html.slice(0, 500),
    };
  } catch (e: any) { results.htmlScrape = { error: e.message }; }
  res.json(results);
});

// Scrape TCGPlayer product page for description + contents
async function scrapeProductPage(url: string, productId: string | null): Promise<{ intelReport: string | null; contents: string[] | null }> {
  const mpHeaders = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.tcgplayer.com/",
    "Origin": "https://www.tcgplayer.com",
    "Accept": "application/json, text/plain, */*",
  };

  function stripHtml(s: string) {
    return s
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  let intelReport: string | null = null;
  let contents: string[] | null = null;

  // Strategy 0: mpapi.tcgplayer.com extendeddata — same domain as pricepoints (no Cloudflare block)
  // This is the only reliable source because TCGPlayer is fully client-side rendered.
  if (productId) {
    try {
      const r = await fetch(
        `https://mpapi.tcgplayer.com/v2/product/${productId}/extendeddata?mpfev=2`,
        { headers: mpHeaders }
      );
      if (r.ok) {
        const data = await r.json() as any;
        const results: any[] = data?.results ?? (Array.isArray(data) ? data : []);
        for (const item of results) {
          const name = (item.name ?? item.displayName ?? "").toLowerCase();
          const value = String(item.value ?? "");
          if (!value || value === "null") continue;
          if (name.includes("description") || name.includes("product detail") || name.includes("overview")) {
            const text = stripHtml(value);
            if (text.length > 80 && !text.toLowerCase().includes("yu-gi-oh")) {
              intelReport = text;
            }
          }
          if (name.includes("content") || name.includes("what's in") || name.includes("box contain")) {
            const lines = stripHtml(value).split("\n").map((s: string) => s.trim()).filter(Boolean);
            if (lines.length) contents = lines;
          }
        }
      }
    } catch {}

    // Strategy 0b: mpapi product details endpoint
    if (!intelReport) {
      try {
        const r = await fetch(
          `https://mpapi.tcgplayer.com/v2/product/${productId}?mpfev=2`,
          { headers: mpHeaders }
        );
        if (r.ok) {
          const data = await r.json() as any;
          const results: any[] = data?.results ?? (Array.isArray(data) ? data : [data]);
          for (const item of results) {
            const desc = item.description ?? item.productDescription ?? item.longDescription ?? null;
            if (desc && typeof desc === "string" && desc.length > 80 && !desc.toLowerCase().includes("yu-gi-oh")) {
              intelReport = stripHtml(desc);
              break;
            }
          }
        }
      } catch {}
    }
  }

  // Strategies 1-3: HTML scraping fallback (often blocked by Cloudflare, kept as last resort)
  if (!intelReport) {
    try {
      const htmlHeaders = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.google.com/",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
        "Upgrade-Insecure-Requests": "1",
      };
      const res = await fetch(url, { headers: htmlHeaders, redirect: "follow" });
      if (res.ok) {
        const html = await res.text();
        if (!html.includes("Just a moment") && !html.includes("challenge-platform")) {
          function findByKey(obj: any, keys: string[], depth = 0): string | null {
            if (depth > 12 || !obj || typeof obj !== "object") return null;
            for (const k of Object.keys(obj)) {
              if (keys.includes(k.toLowerCase()) && typeof obj[k] === "string" && obj[k].length > 80) return obj[k];
              const found = findByKey(obj[k], keys, depth + 1);
              if (found) return found;
            }
            return null;
          }
          function findArrayByKey(obj: any, keys: string[], depth = 0): any[] | null {
            if (depth > 12 || !obj || typeof obj !== "object") return null;
            for (const k of Object.keys(obj)) {
              if (keys.includes(k.toLowerCase()) && Array.isArray(obj[k]) && obj[k].length) return obj[k];
              const found = findArrayByKey(obj[k], keys, depth + 1);
              if (found) return found;
            }
            return null;
          }

          // Strategy 1: JSON-LD
          for (const block of [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)]) {
            try {
              const entries = [JSON.parse(block[1])].flat();
              for (const entry of entries) {
                const desc = entry.description ?? null;
                if (desc && desc.length > 80 && !desc.toLowerCase().includes("yu-gi-oh") && !desc.toLowerCase().includes("pokémon cards, one piece")) {
                  intelReport = stripHtml(String(desc)); break;
                }
              }
            } catch {}
            if (intelReport) break;
          }

          // Strategy 2: __NEXT_DATA__
          if (!intelReport) {
            const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
            if (m) {
              try {
                const nextData = JSON.parse(m[1]);
                const extendedData: any[] = findArrayByKey(nextData, ["extendeddata", "extended_data"]) ?? [];
                for (const item of extendedData) {
                  const name = (item.name ?? item.displayName ?? "").toLowerCase();
                  const value = String(item.value ?? "");
                  if (!value) continue;
                  if (name.includes("description") || name.includes("product detail")) {
                    const text = stripHtml(value);
                    if (text.length > 80) intelReport = text;
                  }
                  if (!contents && name.includes("content")) {
                    const lines = stripHtml(value).split("\n").map((s: string) => s.trim()).filter(Boolean);
                    if (lines.length) contents = lines;
                  }
                }
                if (!intelReport) {
                  const desc = findByKey(nextData, ["description", "longdescription", "productdescription"]);
                  if (desc && !desc.toLowerCase().includes("yu-gi-oh")) intelReport = stripHtml(desc);
                }
              } catch {}
            }
          }

          // Strategy 3: raw JSON string scan
          if (!intelReport) {
            for (const m of [...html.matchAll(/"description"\s*:\s*"((?:[^"\\]|\\.){100,})"/g)]) {
              try {
                const text = JSON.parse(`"${m[1]}"`);
                if (!text.toLowerCase().includes("yu-gi-oh") && !text.toLowerCase().includes("pokémon cards, one piece")) {
                  intelReport = stripHtml(text); break;
                }
              } catch {}
            }
          }
        }
      }
    } catch {}
  }

  return { intelReport, contents };
}

// ─── Pull probability model ───────────────────────────────────────────────────
//
// Two numbers are produced per product and "locked" onto it at lookup time:
//   • tier hit rate  — chance a single pack contains ≥1 card of that tier
//   • per-card odds  — chance a single pack contains a specific named card
//
// Inputs are all real, nothing hand-typed:
//   • slot counts come from the official pack contents (e.g. "5 rare or higher")
//   • per-rarity card counts come from Scryfall (how many mythics exist in the set)
//
// The only thing neither source gives is how the "rare or higher" slots split
// between rare and mythic, so we use WotC's documented sheet convention: a given
// rare is printed ~2× as often as a given mythic.
const RARE_WEIGHT = 2;
const MYTHIC_WEIGHT = 1;

export type RarityCounts = { common: number; uncommon: number; rare: number; mythic: number };
type SlotCounts = { total: number; common: number; uncommon: number; land: number; rarePlus: number };
type Special = { label: string; abbr: string; display: string; percent: number; color: string };
export type Tier = {
  label: string;
  abbr: string;
  percent: number;        // tier hit rate, 0–100 (drives bar/segment sizing)
  display: string;        // human string: "Guaranteed", "~60% / pack", "<1%"
  perCardPct: number | null; // odds for a specific card of this tier, or null (e.g. lands)
  color: string;
};

const probAtLeastOne = (pPerSlot: number, slots: number) =>
  slots <= 0 ? 0 : 1 - Math.pow(1 - pPerSlot, slots);

const pctDisplay = (pct: number) =>
  pct < 1 ? "<1%" : pct < 10 ? `~${pct.toFixed(1)}%` : `~${Math.round(pct)}%`;

/** Pull a count (or midpoint of a range like "5–6") immediately preceding a keyword. */
function parseCount(text: string, keyword: string): number | null {
  const m = text.match(new RegExp(`(\\d+)(?:\\s*[\\u2013\\u2014-]\\s*(\\d+))?\\s+${keyword}`));
  if (!m) return null;
  return m[2] ? (parseInt(m[1]) + parseInt(m[2])) / 2 : parseInt(m[1]);
}

/** Slot composition of one pack, from the official contents text. */
function parseSlotCounts(contents: string[], slug: string): SlotCounts {
  const text = contents.join(" ").toLowerCase();

  let total = parseCount(text, "magic") ?? 15;
  let rarePlus =
    parseCount(text, "cards? of rarity rare or higher") ??
    parseCount(text, "rare or higher") ??
    0;
  let uncommon = parseCount(text, "uncommon") ?? 0;
  let common = parseCount(text, "common") ?? 0;
  let land = parseCount(text, "land") ?? 0;

  // Fallback heuristics by product type when the page scrape yielded no composition
  if (!rarePlus && !uncommon && !common) {
    const isCollector = /collector/i.test(slug);
    const isDraft = /draft/i.test(slug);
    const isSet = /set.booster/i.test(slug);
    if (isCollector)    { total = 15; common = 4; uncommon = 5; land = 1; rarePlus = 5; }
    else if (isDraft)   { total = 15; common = 10; uncommon = 3; land = 0; rarePlus = 2; }
    else if (isSet)     { total = 12; common = 2; uncommon = 3; land = 1; rarePlus = 3; }
    else                { total = 15; common = 5; uncommon = 4; land = 1; rarePlus = 5; }
  }

  return { total, common, uncommon, land, rarePlus };
}

/** Extract special-treatment tiers stated as explicit odds, e.g. "...in <1% of boosters". */
function parseSpecials(contents: string[]): Special[] {
  const specials: Special[] = [];
  for (const line of contents) {
    const m = line.match(/(<\s*)?(\d+(?:\.\d+)?)\s*%\s+of\s+boosters/i);
    if (!m) continue;
    const lt = !!m[1];
    const num = parseFloat(m[2]);
    const display = lt ? `<${m[2]}%` : pctDisplay(num);
    const lower = line.toLowerCase();
    const abbr = /borderless/.test(lower) ? "B" : /foil/.test(lower) ? "F" : "★";
    // Short label: drop the "... in N% of boosters" tail
    const label = line.replace(/\s+in\s+.*$/i, "").replace(/\s+card$/i, "").trim();
    specials.push({ label, abbr, display, percent: lt ? Math.max(0.5, num) : num, color: "#a78bfa" });
  }
  return specials;
}

/** Fetch how many cards of each rarity exist in a set (cheap: reads total_cards only). */
export async function fetchRarityCounts(setCode: string): Promise<RarityCounts> {
  const rarities = ["common", "uncommon", "rare", "mythic"] as const;
  const counts = await Promise.all(
    rarities.map(async (r) => {
      try {
        const res = await scryfallFetch(
          `https://api.scryfall.com/cards/search?q=set:${setCode}+rarity:${r}&unique=cards`
        );
        if (!res.ok) return 0;
        const d = (await res.json()) as { total_cards?: number; data?: any[] };
        return d.total_cards ?? d.data?.length ?? 0;
      } catch {
        return 0;
      }
    })
  );
  return { common: counts[0], uncommon: counts[1], rare: counts[2], mythic: counts[3] };
}

/** Odds a specific named card of a given rarity appears in one pack. */
export function perCardOdds(
  rarity: string,
  slots: SlotCounts,
  counts: RarityCounts
): number | null {
  const totW = counts.rare * RARE_WEIGHT + counts.mythic * MYTHIC_WEIGHT;
  switch (rarity) {
    case "common":
      return counts.common ? probAtLeastOne(1 / counts.common, slots.common) * 100 : null;
    case "uncommon":
      return counts.uncommon ? probAtLeastOne(1 / counts.uncommon, slots.uncommon) * 100 : null;
    case "rare":
      return totW ? probAtLeastOne(RARE_WEIGHT / totW, slots.rarePlus) * 100 : null;
    case "mythic":
      return totW ? probAtLeastOne(MYTHIC_WEIGHT / totW, slots.rarePlus) * 100 : null;
    default:
      return null;
  }
}

/**
 * Build the locked tier table for a product from its contents + Scryfall counts.
 * Tier hit rate = chance a pack contains ≥1 of that tier (per-pack), NOT a share
 * of the pack — so these do not sum to 100.
 */
function computeTiers(
  slots: SlotCounts,
  counts: RarityCounts,
  specials: Special[]
): Tier[] {
  const totW = counts.rare * RARE_WEIGHT + counts.mythic * MYTHIC_WEIGHT;
  const tier = (
    label: string,
    abbr: string,
    color: string,
    hitRate: number,
    perCardPct: number | null
  ): Tier => ({
    label,
    abbr,
    color,
    percent: Math.round(hitRate * 100),
    display: hitRate >= 0.995 ? "Guaranteed" : `${pctDisplay(hitRate * 100)} / pack`,
    perCardPct,
  });

  const tiers: Tier[] = [];
  // Standard rarities are guaranteed slots in most boosters → tier hit rate ~100%.
  if (slots.common > 0)
    tiers.push(tier("Common", "C", "#6b7280", probAtLeastOne(1, slots.common), perCardOdds("common", slots, counts)));
  if (slots.uncommon > 0)
    tiers.push(tier("Uncommon", "U", "#60a5fa", probAtLeastOne(1, slots.uncommon), perCardOdds("uncommon", slots, counts)));
  if (slots.rarePlus > 0 && totW) {
    tiers.push(tier("Rare", "R", "#fbbf24", probAtLeastOne((counts.rare * RARE_WEIGHT) / totW, slots.rarePlus), perCardOdds("rare", slots, counts)));
    tiers.push(tier("Mythic Rare", "M", "#f97316", probAtLeastOne((counts.mythic * MYTHIC_WEIGHT) / totW, slots.rarePlus), perCardOdds("mythic", slots, counts)));
  }
  if (slots.land > 0)
    tiers.push(tier("Land", "L", "#4ade80", probAtLeastOne(1, slots.land), null));

  for (const s of specials) {
    tiers.push({
      label: s.label,
      abbr: s.abbr,
      color: s.color,
      percent: Math.round(s.percent),
      display: s.display,
      perCardPct: null,
    });
  }

  return tiers;
}

/**
 * Compute the full pull-probability payload for a set: the tier table plus a
 * per-card odds lookup by rarity (used to label individual possible-pull cards).
 */
export function computePullData(
  contents: string[],
  slug: string,
  counts: RarityCounts
): {
  tiers: Tier[];
  perCardByRarity: Record<string, { pct: number; display: string }>;
  specials: Special[];
} {
  const slots = parseSlotCounts(contents, slug);
  const specials = parseSpecials(contents);
  const tiers = computeTiers(slots, counts, specials);

  const perCardByRarity: Record<string, { pct: number; display: string }> = {};
  for (const r of ["common", "uncommon", "rare", "mythic"]) {
    const pct = perCardOdds(r, slots, counts);
    if (pct != null) perCardByRarity[r] = { pct, display: pctDisplay(pct) };
  }

  return { tiers, perCardByRarity, specials };
}

// ─── Set resolution from a TCGPlayer URL ────────────────────────────────────────

/** Parse a TCGPlayer product slug into a set name + pack type for Scryfall matching. */
export function parseTcgSlug(url: string): { slug: string; setName: string; packType: string | null } {
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split("/").filter(Boolean);
  const slug = pathParts[pathParts.length - 1] ?? "";

  const packMatch = slug.match(/(collector-booster(?:-pack|-box)?|draft-booster(?:-pack|-box)?|set-booster(?:-pack|-box)?|booster-(?:pack|box)|booster-display)/i);
  const packType = packMatch ? titleCase(packMatch[0].replace(/-/g, " ")) : null;

  let setName = slug
    .replace(/^magic-the-gathering-/, "")
    .replace(/^magic-/, "")
    .replace(/([-_]collector[-_]booster.*)$/i, "")
    .replace(/([-_]draft[-_]booster.*)$/i, "")
    .replace(/([-_]set[-_]booster.*)$/i, "")
    .replace(/([-_]booster[-_](?:pack|box|display).*)$/i, "")
    .replace(/-\d+$/, "")
    .replace(/-/g, " ")
    .trim();
  setName = dedupeWords(setName);

  return { slug, setName, packType };
}

/** Pick the best-matching Scryfall set for a parsed set name. */
export function matchScryfallSet(setName: string, setsData: any[]): any | null {
  const needle = setName.toLowerCase();
  const EXCLUDED_TYPES = new Set(["token", "memorabilia", "promo"]);
  const candidates = setsData.filter((s: any) => {
    if (EXCLUDED_TYPES.has(s.set_type)) return false;
    const n = s.name.toLowerCase().replace(/^universes beyond: /i, "");
    return n.includes(needle) || needle.includes(n);
  });
  candidates.sort((a: any, b: any) => {
    const aName = a.name.toLowerCase().replace(/^universes beyond: /i, "");
    const bName = b.name.toLowerCase().replace(/^universes beyond: /i, "");
    if (aName === needle && bName !== needle) return -1;
    if (bName === needle && aName !== needle) return 1;
    return aName.length - bName.length;
  });
  return candidates[0] ?? null;
}

/** Resolve a TCGPlayer product URL to its Scryfall set (one /sets fetch). */
export async function resolveSetFromTcgUrl(url: string): Promise<{ set: any; slug: string } | null> {
  const { slug, setName } = parseTcgSlug(url);
  const setsRes = await scryfallFetch("https://api.scryfall.com/sets");
  if (!setsRes.ok) return null;
  const setsData = (await setsRes.json()) as { data: any[] };
  const set = matchScryfallSet(setName, setsData.data);
  return set ? { set, slug } : null;
}

/** Map a possible-pull card's stored subtitle (e.g. "Mythic Rare · Eastman Art") to a Scryfall rarity. */
export function rarityFromSubtitle(subtitle: string): string | null {
  const s = (subtitle || "").toLowerCase();
  if (s.includes("mythic")) return "mythic";
  if (s.includes("uncommon")) return "uncommon"; // check before "common"
  if (s.includes("rare")) return "rare";
  if (s.includes("common")) return "common";
  return null;
}

// ─── Possible-pulls selection ───────────────────────────────────────────────────

const RARITY_LABEL: Record<string, string> = {
  mythic: "Mythic Rare",
  rare: "Rare",
  uncommon: "Uncommon",
  common: "Common",
};

export type PossiblePull = {
  id: number;
  title: string;
  subtitle: string;
  probability: string;
  scryfallImage: string;
  featured: boolean;
};

const cardImage = (c: any): string | null =>
  c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal ?? null;

/** Name the special printing treatment of a card, if any (borderless, showcase…). */
function treatmentOf(c: any): string | null {
  if (c.border_color === "borderless") return "Borderless";
  const fe: string[] = c.frame_effects ?? [];
  if (fe.includes("showcase")) return "Showcase";
  if (fe.includes("extendedart")) return "Extended Art";
  if (c.full_art) return "Full Art";
  if ((c.promo_types ?? []).length) return "Special";
  return null;
}

/**
 * The set's most valuable cards (every printing, priced), highest first. Excludes
 * basic lands. `unique=prints` so a card's pricier treatment (borderless/foil)
 * can win — we de-dupe by name later, keeping the most valuable version.
 */
export async function fetchTopCardsByValue(setCode: string): Promise<any[]> {
  const res = await scryfallFetch(
    `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`set:${setCode} -t:basic`)}&unique=prints&order=usd&dir=desc&page=1`
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { data?: any[] };
  return data.data ?? [];
}

/**
 * Pick the top `limit` most valuable, distinct, image-having cards and shape them
 * into storefront possible-pull cards with their locked per-card odds attached.
 * Cards are assumed pre-sorted by value descending (see fetchTopCardsByValue), so
 * de-duping by name keeps the priciest printing of each card.
 */
// How the possible-pulls showcase is composed: the top chase cards ranked by
// rarity first (mythics, then rares) with $ value as the tiebreak, then a
// sampling of the set's nicest uncommons + commons so the lineup shows the
// everyday pulls too (not just the headliners).
const TOP_CHASE_COUNT = 5;
const UNCOMMON_COUNT = 3;
const COMMON_COUNT = 2;

// Higher rank = rarer. Used to order the chase group rarity-first.
const RARITY_RANK: Record<string, number> = { mythic: 4, rare: 3, uncommon: 2, common: 1 };

/**
 * Build the possible-pulls showcase: the {@link TOP_CHASE_COUNT} rarest distinct
 * cards (mythics first, then rares, value as the tiebreak within each tier),
 * followed by the priciest uncommons and commons. `cards` must be pre-sorted by
 * value descending (see {@link fetchTopCardsByValue}).
 */
export function buildPossiblePulls(
  cards: any[],
  perCardByRarity: Record<string, { pct: number; display: string }>,
  specials: Special[] = []
): PossiblePull[] {
  // Rarest stated special-treatment rate (e.g. the "<1% of boosters" borderless
  // headliner) — used to label rare/mythic special printings honestly instead of
  // giving them the standard per-rarity odds, which would overstate these chases.
  const rarestSpecial = [...specials].sort((a, b) => a.percent - b.percent)[0];
  const seen = new Set<string>();

  // Pick up to `limit` distinct, image-having cards (optionally filtered to a set
  // of rarities), most valuable first. Mutates `seen` so groups don't overlap.
  const take = (limit: number, rarities?: Set<string>, source: any[] = cards) => {
    const out: Omit<PossiblePull, "id" | "featured">[] = [];
    for (const c of source) {
      if (out.length >= limit) break;
      const img = cardImage(c);
      if (!c.name || !img || seen.has(c.name)) continue;
      if (rarities && !rarities.has(c.rarity)) continue;
      seen.add(c.name);

      const treatment = treatmentOf(c);
      const rarityLabel = RARITY_LABEL[c.rarity] ?? "Rare";
      const subtitle = treatment ? `${rarityLabel} · ${treatment}` : rarityLabel;
      // Only rare/mythic special printings inherit the special rate; a showcase
      // common is still a common, so it keeps standard per-rarity odds.
      const isChase = !!treatment && !!rarestSpecial && (c.rarity === "mythic" || c.rarity === "rare");
      const odds = isChase ? rarestSpecial.display : perCardByRarity[c.rarity]?.display;

      out.push({ title: c.name, subtitle, probability: odds ?? "", scryfallImage: img });
    }
    return out;
  };

  // Chase group: rarity first (mythics before rares), value as the tiebreak.
  // `cards` is already value-desc and Array.sort is stable, so sorting by rarity
  // rank keeps the value ordering within each tier. Restrict to rare+mythic so
  // the headliners are always the genuinely rare cards; if a set somehow has
  // fewer than 5, we simply show what exists.
  const chaseRanked = [...cards]
    .filter((c) => c.rarity === "mythic" || c.rarity === "rare")
    .sort((a, b) => (RARITY_RANK[b.rarity] ?? 0) - (RARITY_RANK[a.rarity] ?? 0));

  const composed = [
    ...take(TOP_CHASE_COUNT, undefined, chaseRanked),
    ...take(UNCOMMON_COUNT, new Set(["uncommon"])),
    ...take(COMMON_COUNT, new Set(["common"])),
  ];
  return composed.map((c, i) => ({ ...c, id: i + 1, featured: i === 0 }));
}

function buildSpecs(set: any, slug: string): { label: string; value: string }[] {
  const specs: { label: string; value: string }[] = [];
  specs.push({ label: "SET", value: set.name });
  if (set.released_at) specs.push({ label: "RELEASE", value: set.released_at.substring(0, 4) });
  const isBox = /booster[-_]box|booster[-_]display/i.test(slug);
  const isCollector = /collector/i.test(slug);
  const isSetBooster = /set[-_]booster/i.test(slug);
  const packsPerBox = isCollector ? "12" : isSetBooster ? "30" : "36";
  specs.push({ label: "PACKS / BOX", value: isBox ? packsPerBox : "1" });
  specs.push({ label: "CARDS / PACK", value: isSetBooster ? "12" : "15" });
  return specs;
}

function generateContents(slug: string): string[] {
  const isCollector = /collector/i.test(slug);
  const isDraft = /draft/i.test(slug);
  const isSet = /set[-_]booster/i.test(slug);
  if (isCollector) return [
    "15 cards per pack",
    "5 cards of rarity rare or higher (foil and special frame treatments)",
    "5 Uncommon cards (including foil uncommons)",
    "4 Common or special alternate-frame cards",
    "1 Traditional foil basic land",
  ];
  if (isSet) return [
    "12 cards per pack",
    "1–2 cards of rarity rare or higher",
    "2–4 Uncommon cards",
    "1 Full-art or special treatment card",
    "1 Art card",
    "1 Token or ad card",
  ];
  // Draft (default)
  return [
    "15 cards per pack",
    "1 card of rarity rare or higher",
    "3 Uncommon cards",
    "10 Common cards",
    "1 Basic land",
  ];
}

function generateIntelReport(set: any, slug: string): string {
  const isCollector = /collector/i.test(slug);
  const isDraft = /draft/i.test(slug);
  const isSet = /set[-_]booster/i.test(slug);
  const isBox = /booster[-_]box|booster[-_]display/i.test(slug);
  const year = set.released_at ? set.released_at.substring(0, 4) : null;
  const cardCount = set.card_count ? `${set.card_count}-card` : "";
  const packCount = isCollector ? "12" : isSet ? "30" : "36";
  const unit = isBox ? `box of ${packCount} packs` : "pack";

  let report = "";
  if (isCollector) {
    report = `${set.name} Collector Boosters are the premium way to collect from this set. Every pack is stacked with foils, extended-art, alternate-art, and special-frame treatments you won't find in any other booster type.\n\n`;
    report += `Each pack contains 15 cards with multiple guaranteed foil slots and at least one rare or mythic rare with a premium treatment. Collector Boosters are built for players who want the best the set has to offer.`;
  } else if (isSet) {
    report = `${set.name} Set Boosters are designed to maximize the excitement of opening packs. Each pack is hand-crafted for the best possible experience, averaging more rares than Draft Boosters.\n\n`;
    report += `Each 12-card pack includes at least one rare or mythic rare, a curated run of thematically linked cards, an art card, and a chance at a foil or special treatment card.`;
  } else {
    report = `${set.name} Draft Boosters are the classic format for Booster Draft and Sealed Deck play. Each pack delivers a balanced mix of commons, uncommons, and rares — everything you need to build a competitive limited deck.\n\n`;
    report += `Each 15-card pack contains one rare or mythic rare, three uncommons, ten commons, and a basic land. Perfect for drafting with friends or grinding tournaments.`;
  }
  if (year || cardCount) {
    report += `\n\nReleased${year ? ` in ${year}` : ""}, ${set.name} is a ${cardCount} set that rewards both competitive players and dedicated collectors.`;
  }
  if (isBox) {
    report += ` This booster box contains ${packCount} packs.`;
  }
  return report;
}

// Lookup product data from a TCGPlayer URL
router.post("/lookup/tcgplayer", async (req, res) => {
  const { url } = req.body as { url: string };
  if (!url) { res.status(400).json({ error: "url is required" }); return; }

  try {
    const { slug, setName, packType } = parseTcgSlug(url);
    const suggestedTitle = [titleCase(setName), packType].filter(Boolean).join(" ");

    // Extract product ID for mpapi calls
    const productIdMatch = url.match(/\/product\/(\d+)\//);
    const productId = productIdMatch?.[1] ?? null;

    // Scrape TCGPlayer for image + price + product details, and fetch Scryfall sets — all in parallel
    const [tcgData, setsRes, pageDetails] = await Promise.all([
      scrapeTCGPlayer(url),
      scryfallFetch("https://api.scryfall.com/sets"),
      scrapeProductPage(url, productId),
    ]);

    const tcgImageUrl = tcgData.imageUrl;
    const tcgLowestPrice = tcgData.lowestPrice;

    // Try to find a matching Scryfall set
    if (setsRes.ok) {
      const setsData = await setsRes.json() as { data: any[] };
      const set = matchScryfallSet(setName, setsData.data);

      if (set) {
        const finalContents = pageDetails.contents ?? generateContents(slug);
        const baseIntelReport = pageDetails.intelReport ?? generateIntelReport(set, slug);

        // Fetch the set's most valuable cards + per-rarity counts in parallel
        const [valueCards, rarityCounts] = await Promise.all([
          fetchTopCardsByValue(set.code),
          fetchRarityCounts(set.code),
        ]);

        // Locked tier table + per-card odds, derived from contents + Scryfall counts
        const { tiers, perCardByRarity, specials } = computePullData(finalContents, slug, rarityCounts);

        // Top chase cards + a sampling of uncommons/commons, ready for the storefront
        const possiblePulls = buildPossiblePulls(valueCards, perCardByRarity, specials);

        // Auto-style the intel report in TTD voice on every lookup, seeding Claude
        // with this set's headliner cards so the copy names real characters. Falls
        // back to the base boilerplate if ANTHROPIC_API_KEY is unset or the call fails.
        const chaseCards = possiblePulls
          .filter((p) => /mythic|rare/i.test(p.subtitle))
          .map((p) => p.title)
          .slice(0, 6);
        const finalIntelReport = await styleIntelReportSafe({
          report: baseIntelReport,
          productTitle: suggestedTitle,
          chaseCards,
        });

        // A wider, deduped preview for the admin lookup panel (odds attached)
        const seenPreview = new Set<string>();
        const topCards: any[] = [];
        for (const c of valueCards) {
          if (topCards.length >= 12) break;
          if (!c.name || seenPreview.has(c.name)) continue;
          seenPreview.add(c.name);
          const odds = c.rarity ? perCardByRarity[c.rarity] : undefined;
          topCards.push({
            id: c.id,
            name: c.name,
            imageUrl: cardImage(c),
            usd: c.prices?.usd ?? null,
            rarity: c.rarity ?? null, // "mythic" | "rare" | "uncommon" | "common"
            probability: odds?.display ?? "",     // locked per-card odds, e.g. "~3.9%"
            probabilityPct: odds?.pct ?? null,
          });
        }

        res.json({
          type: "set",
          suggestedTitle,
          setCode: set.code,
          setName: set.name,
          rarityCounts,
          topCards,
          possiblePulls,
          scryfallId: null,
          imageUrl: tcgImageUrl ?? topCards[0]?.imageUrl ?? null,
          usd: tcgLowestPrice,
          specs: buildSpecs(set, slug),
          intelReport: finalIntelReport,
          contents: finalContents,
          pullProbabilities: tiers,
        });
        return;
      }
    }

    // Fall back: search Scryfall for an individual card by name
    const searchRes = await scryfallFetch(
      `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(setName)}`
    );

    if (!searchRes.ok) {
      const broadRes = await scryfallFetch(
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent(setName)}&order=usd&dir=desc`
      );
      if (!broadRes.ok) {
        res.status(404).json({ error: `No card or set found for: "${setName}"` });
        return;
      }
      const broadData = await broadRes.json() as { data: any[] };
      const card = broadData.data?.[0];
      if (!card) { res.status(404).json({ error: "No results" }); return; }
      res.json({
        type: "card",
        suggestedTitle: card.name,
        scryfallId: card.id,
        name: card.name,
        imageUrl: tcgImageUrl ?? card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal ?? null,
        usd: tcgLowestPrice ?? card.prices?.usd ?? null,
        topCards: [],
      });
      return;
    }

    const card = await searchRes.json() as any;
    res.json({
      type: "card",
      suggestedTitle: card.name,
      scryfallId: card.id,
      name: card.name,
      imageUrl: tcgImageUrl ?? card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal ?? null,
      usd: tcgLowestPrice ?? card.prices?.usd ?? null,
      topCards: [],
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Lookup failed" });
  }
});

// ─── Intel report styling (TTD brand voice via Claude) ───────────────────────────

const INTEL_MODEL = "claude-sonnet-5";

/**
 * The TTD house-voice prompt: cheesy, lore-first, set-specific copy modeled on the
 * TMNT example. `chaseCards` (iconic/valuable card names for the set) let Claude
 * name real characters even for sets it knows less well.
 */
function buildIntelPrompt(report: string, productTitle: string | undefined, chaseCards: string[] = []): string {
  const chaseLine = chaseCards.length
    ? `\nHEADLINE CARDS IN THIS SET (weave a few in by name for authentic flavor, but do NOT talk about their rarity or value): ${chaseCards.join(", ")}\n`
    : "";
  return `You write intel copy for Tommy Top Decker Trading Co, a Magic: The Gathering sealed product drop shop. Write a short, punchy product intel report for the product below.

RULES — follow every one exactly:
- No em dashes (never use — or –)
- No mention of card rarity, card quality, foils, or how good cards look. Zero.
- Lead with the LORE and WORLD of the product. What is this IP, universe, or setting? What makes it culturally special? Reference specific characters, places, events, or jokes from the source material the way the TMNT example uses pizza and the sewer lair.
- Be a little cheesy. Lean into the niche. Sound like a superfan who knows the deep cuts of this world, not a generic hype-man.
- Short punchy paragraphs. Energy. Personality. Like a collector who actually loves this stuff wrote it.
- 4 to 6 paragraphs max.
- Plain text only. Paragraphs separated by a single blank line. No headers, bullets, or markdown.

TMNT EXAMPLE (notice: pizza reference, sewer lair, the Turtles by name, Kevin Eastman — all world-specific flavor. Zero card quality talk):
These things vanished faster than a pizza at the lair the last time we saw them. But fear not!!! Another batch of mutagen-enhanced TMNT Magic Collector Boosters just crawled out of the sewer and they are LOADED.

We're talking all four Turtles. Leonardo, Donatello, Raphael, and Michelangelo. Illustrated by the original co-creator himself, Kevin Eastman.

And yes... there's a chance at the borderless source-material cards dripping with nostalgia thicker than mozzarella on a late-night pepperoni slice.

I mean... come on. That's basically the cardboard equivalent of finding the secret entrance to the sewer lair.

PRODUCT: ${productTitle ?? "Magic: The Gathering Product"}${chaseLine}
CONTEXT: ${report}

Write the intel report now:`;
}

/** Call Claude with a prepared intel prompt. Throws on any API/network failure. */
async function callClaudeIntel(apiKey: string, prompt: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: INTEL_MODEL,
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    const err: any = await response.json().catch(() => ({}));
    throw new Error(err.error?.message ?? "Anthropic API failed");
  }
  const data: any = await response.json();
  return (data.content?.[0]?.text ?? "").trim();
}

/**
 * Style an intel report in the TTD voice, NEVER throwing: if the key is missing or
 * the API fails, returns the original report unchanged. Used to auto-style on every
 * lookup so the admin never sees the generic boilerplate — degrades gracefully when
 * ANTHROPIC_API_KEY isn't set on the server.
 */
async function styleIntelReportSafe(opts: { report: string; productTitle?: string; chaseCards?: string[] }): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!opts.report || !apiKey) {
    if (!apiKey) console.warn("[intel] ANTHROPIC_API_KEY not set — returning un-styled boilerplate");
    return opts.report;
  }
  try {
    const styled = await callClaudeIntel(apiKey, buildIntelPrompt(opts.report, opts.productTitle, opts.chaseCards));
    return styled || opts.report;
  } catch (err: any) {
    console.warn("[intel] auto-style failed, returning boilerplate:", err?.message);
    return opts.report;
  }
}

// Restyle intel report in the TTD brand voice using Claude (manual "Style It" button).
// Surfaces errors to the admin (503 if no key, 500 on API failure) — unlike the
// auto-style path, which silently falls back.
router.post("/intel-report/restyle", requireAdmin, async (req, res) => {
  const { intelReport, productTitle, chaseCards } = req.body as { intelReport?: string; productTitle?: string; chaseCards?: string[] };
  if (!intelReport) { res.status(400).json({ error: "intelReport required" }); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { res.status(503).json({ error: "ANTHROPIC_API_KEY not configured on Railway" }); return; }

  try {
    const text = await callClaudeIntel(apiKey, buildIntelPrompt(intelReport, productTitle, chaseCards));
    res.json({ intelReport: text });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to restyle" });
  }
});

// Remove background from an image URL using remove.bg
router.post("/remove-background", requireAdmin, async (req, res) => {
  const { imageUrl } = req.body as { imageUrl?: string };
  if (!imageUrl) { res.status(400).json({ error: "imageUrl required" }); return; }

  const apiKey = process.env.REMOVE_BG_API_KEY;
  if (!apiKey) { res.status(503).json({ error: "REMOVE_BG_API_KEY not configured" }); return; }

  try {
    const response = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl, size: "auto" }),
    });

    if (!response.ok) {
      const err: any = await response.json().catch(() => ({}));
      res.status(500).json({ error: err.errors?.[0]?.title ?? "remove.bg failed" });
      return;
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    res.json({ png: `data:image/png;base64,${base64}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to remove background" });
  }
});

export default router;
