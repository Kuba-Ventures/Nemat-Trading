
// ─── MOCK DATA ───────────────────────────────────────────────────────────────
// Edit this file to update product details, prices, pull probabilities, etc.

export const product = {
  // ── Brand ──────────────────────────────────────────────────────────────────
  brand: "Tommy Top Decker Trading",

  // ── Product ────────────────────────────────────────────────────────────────
  imageUrl: "/product.png",
  title: "Teenage Mutant Ninja Turtles",
  subtitle: "Collector Booster Pack",
  status: "FLASH DROP // ACTIVE",

  // ── Pricing ────────────────────────────────────────────────────────────────
  tcgBestPrice: 37.49,
  dropPrice: 32,
  savingsPercent: 15,

  // ── Countdown target (ISO string or ms from now for demo) ──────────────────
  // Set to a future date/time for a real drop.
  dropExpiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000 + 37 * 60 * 1000 + 22 * 1000).toISOString(),
  revealCountdownAt: new Date(Date.now() + 23 * 60 * 60 * 1000 + 14 * 60 * 1000 + 9 * 1000).toISOString(),

  // ── Intel Report ───────────────────────────────────────────────────────────
  intelReport: [
    {
      text: "These things vanished faster than a pizza at the lair the last time we saw them. But fear not!!! Another batch of mutagen-enhanced TMNT Magic Collector Boosters just crawled out of the sewer and they are LOADED.",
      highlights: [],
    },
    {
      text: "We're talking Turtle-powered rares and mythic rares, traditional foils shining brighter than a freshly sharpened katana, and full-art lands that look like they were pulled straight from the underground tunnels of NYC. And yes...there's a chance at the borderless source-material cards dripping with nostalgia thicker than mozzarella on a late-night pepperoni slice.",
      highlights: ["rares", "mythic rares", "traditional foils", "full-art lands", "borderless source-material cards"],
    },
    {
      text: "But the REAL headline? Ohhhh yes...",
      highlights: [],
    },
    {
      text: "All four Turtles. Leonardo, Donatello, Raphael, and Michelangelo. Illustrated by the original co-creator himself, Kevin Eastman.",
      highlights: ["Leonardo", "Donatello", "Raphael", "Michelangelo", "Kevin Eastman"],
    },
    {
      text: "I mean... come on. That's basically the cardboard equivalent of finding the secret entrance to the sewer lair.",
      highlights: [],
    },
  ],

  // ── Specifications ─────────────────────────────────────────────────────────
  specs: [
    { label: "SET", value: "Teenage Mutant Ninja Turtles" },
    { label: "RELEASE", value: "2025" },
    { label: "PACKS / BOX", value: "1" },
    { label: "CARDS / PACK", value: "15" },
  ],

  contents: [
    "15 Magic: The Gathering cards",
    "May contain these cards: TMT 1–190, 196–314; TMC 1–97; PZA 1–20",
    "0–3 surge foil cards",
    "9–12 traditional foil cards",
    "5 cards of rarity rare or higher",
    "3–4 uncommon cards",
    "5–6 common cards",
    "1 land card",
    "Borderless signature Kevin Eastman headliner card in <1% of boosters",
  ],

  copyright: "© 2025 Wizards of the Coast LLC. © 2025 Viacom International. TEENAGE MUTANT NINJA TURTLES is a trademark of Viacom International Inc. All rights reserved.",

  // ── Pull Probabilities ─────────────────────────────────────────────────────
  // Per-pack hit rate (chance a pack contains ≥1 of this tier) + per-card odds.
  // Derived from the official pack contents + Scryfall set counts (set: tmt —
  // 72 common / 55 uncommon / 53 rare / 21 mythic), 2:1 rare:mythic weighting.
  // These do NOT sum to 100 — standard rarities are guaranteed slots.
  pullProbabilities: [
    { label: "Common", abbr: "C", percent: 100, display: "Guaranteed", perCardPct: 7.4, color: "#6b7280" },
    { label: "Uncommon", abbr: "U", percent: 100, display: "Guaranteed", perCardPct: 6.2, color: "#60a5fa" },
    { label: "Rare", abbr: "R", percent: 100, display: "Guaranteed", perCardPct: 7.6, color: "#fbbf24" },
    { label: "Mythic Rare", abbr: "M", percent: 59, display: "~59% / pack", perCardPct: 3.9, color: "#f97316" },
    { label: "Land", abbr: "L", percent: 100, display: "Guaranteed", perCardPct: null, color: "#4ade80" },
    { label: "Borderless Eastman headliner", abbr: "B", percent: 1, display: "<1%", perCardPct: null, color: "#a78bfa" },
  ],

  donutCenter: {
    label: "Mythic Rare",
    percent: "~59%",
    sub: "per pack",
  },

  // ── Possible Pulls ─────────────────────────────────────────────────────────
  // The 5 most valuable distinct cards in the set, selected automatically by the
  // backend (top USD printings, basic lands excluded, de-duped by name) with
  // locked per-card odds. Images via Scryfall (https://scryfall.com).
  possiblePulls: [
    {
      id: 1,
      title: "Leonardo, Sewer Samurai",
      subtitle: "Mythic Rare · Borderless",
      probability: "<1%",
      scryfallImage: "https://cards.scryfall.io/normal/front/7/4/74628e5a-7500-45d3-8147-30d2ef06da50.jpg?1768672769",
      featured: true,
    },
    {
      id: 2,
      title: "Donatello, Mutant Mechanic",
      subtitle: "Mythic Rare · Borderless",
      probability: "<1%",
      scryfallImage: "https://cards.scryfall.io/normal/front/b/8/b818aa60-b312-457a-b167-b66f7c0cc5f4.jpg?1771345101",
      featured: false,
    },
    {
      id: 3,
      title: "Raphael, Ninja Destroyer",
      subtitle: "Mythic Rare · Borderless",
      probability: "<1%",
      scryfallImage: "https://cards.scryfall.io/normal/front/5/5/55f67220-3b95-49b9-9712-fedc6a67ff4b.jpg?1771345107",
      featured: false,
    },
    {
      id: 4,
      title: "Michelangelo, Improviser",
      subtitle: "Mythic Rare · Borderless",
      probability: "<1%",
      scryfallImage: "https://cards.scryfall.io/normal/front/d/c/dc54cba7-732c-4e09-9413-ad36603a6517.jpg?1771345114",
      featured: false,
    },
    {
      id: 5,
      title: "Super Shredder",
      subtitle: "Mythic Rare · Full Art",
      probability: "<1%",
      scryfallImage: "https://cards.scryfall.io/normal/front/b/a/ba38abbd-97b2-47e0-8cb6-7f4a02843e42.jpg?1771345060",
      featured: false,
    },
  ],
};
