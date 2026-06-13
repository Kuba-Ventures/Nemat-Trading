# Nemat / Tommy Top Decker Trading
*Magic: The Gathering booster-pack drop storefront with live shipping, Stripe checkout, and an admin panel.*

*Last updated: 2026-06-12 14:30 ET by kuba-vault*

---

## TL;DR  [rewrite]

Tommy Top Decker Trading is a single-product-at-a-time MTG booster-pack drop site: browse a product, get a live USPS quote, check out with Stripe, and the order lands in Postgres and a Google Sheet. It's live, in post-MVP iteration. This session shipped accurate, locked pull probabilities — per-pack hit rates derived from each product's pack contents plus live Scryfall card counts — replacing the hand-typed fake numbers, and fixed a latent bug where every Scryfall call was silently failing (missing User-Agent). Phase 2 (which example cards show as "possible pulls," images, ordering) is still open. Frontend and backend must deploy together this time, and someone must click "Re-lock pull odds" once after deploy.

---

## What it is  [rewrite when value prop evolves]

**The problem:** Buyers of MTG booster packs can't see real odds of pulling a given rarity or card; sellers either omit odds or make them up.
**The solution:** A drop storefront that advertises *derived, verifiable* pull probabilities per product, with live shipping quotes and Stripe checkout.
**The user:** MTG collectors buying single curated booster-pack drops.
**The value:** Honest, sourced odds (Scryfall + official pack contents) plus a clean buy-and-ship flow.

---

## Status  [rewrite]

- **Phase:** live / post-MVP iteration
- **Engagement manager:** self-directed
- **Lead:** Finley
- **Cadence:** self-directed
- **Next milestone:** ship pull-probabilities phase 1 (deploy FE+BE together, run re-lock); then phase 2 (possible-pulls card selection)
- **Flags:** shipping

---

## Where we are right now  [rewrite]

Just landed phase 1 of accurate pull probabilities on master (commits `9b6d2df`, `de0e5b5`). Tier percentages now mean *per-pack hit rate* (chance a pack contains ≥1 of that tier), not share-of-100, and they're derived automatically from each product's official pack-contents text plus live Scryfall per-rarity counts. The rare-vs-mythic split uses WotC's documented 2:1 sheet convention. Per-card odds are computed and locked onto each product. Along the way we found and fixed a latent bug: Scryfall now returns HTTP 400 without a User-Agent/Accept header, so every Scryfall call was silently broken — all calls now route through a `scryfallFetch()` wrapper. Next concrete step: deploy frontend and backend together (the new per-pack data on an old donut frontend would render numbers summing >300% and break the storefront), then click "Re-lock pull odds" once to upgrade all existing products including TMNT. Phase 2 — which cards show as "possible pulls," their images and ordering — is still open.

---

## What's built  [rewrite]

**Frontend / UI** (`artifacts/nemat-drop`, Vite/React → Vercel)
- Storefront product page with live USPS shipping quotes and Stripe checkout (`src/pages/checkout.tsx`, `success.tsx`).
- Customer accounts: email+password login with magic-link fallback, order history (`src/pages/account.tsx`).
- Admin panel (`src/pages/admin.tsx`): unified top nav (Storefront link + Products / Orders / Waitlist tabs), hidden admin entry; product management, order + waitlist dashboards, Stripe order backfill/sync, and a new "Re-lock pull odds" button.
- Pull-probability chart now renders per-pack hit-rate bars; the donut was removed because hit rates don't sum to 100 (`src/components/PullProbabilityChart.tsx`).
- Mock fallback data updated to accurate TMNT values (`src/data/product.ts`).

**Backend / data** (`artifacts/api-server`, Express 5 + TS → Railway)
- Routes: `account`, `checkout`, `orders`, `products`, `scryfall`, `shipping`, `subscribers`, `upload`, `webhooks`, `health`.
- Probability model in `src/routes/scryfall.ts`: `computePullData`, `fetchRarityCounts`, `perCardOdds`, set-resolution helpers (`parseTcgSlug`, `matchScryfallSet`, `resolveSetFromTcgUrl`), and the `scryfallFetch()` wrapper.
- New admin endpoint `POST /api/admin/products/relock-pulls` in `src/routes/products.ts` — idempotent backfill that recomputes odds for every existing product.
- Stripe checkout + webhooks, Shippo USPS rates, Google Apps Script sheet sync (Apps Script under `artifacts/api-server/apps-script/`).
- DB columns added as idempotent ALTER TABLE in the API-server bootstrap (no migration system — see Risks).

**Infrastructure**
- pnpm monorepo. Shared libs: `lib/db` (Drizzle + pg pool, `@workspace/db`), `lib/api-zod`, `lib/api-client-react`, `lib/api-spec` (OpenAPI + Orval).
- Supervised PR factory: low-risk presentational changes auto-merge; backend, db, money/auth, and config changes always escalate to a human (`.claude/agents/pr-reviewer.md`).

---

## Tech stack  [rewrite — scanned from package.json / pnpm-workspace.yaml]

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Vite 7 + React 19 + Tailwind 4, Radix UI, TanStack Query, framer-motion | `artifacts/nemat-drop` → Vercel |
| Backend | Express 5 + TypeScript (tsx) | `artifacts/api-server` → Railway |
| Database | PostgreSQL + Drizzle ORM (Supabase-hosted) | `lib/db` |
| Payments | Stripe Checkout (`stripe ^17`) | `src/routes/checkout.ts`, `webhooks.ts` |
| Shipping | Shippo (USPS rates) | `src/routes/shipping.ts` |
| Order sync | Google Apps Script webhook | `artifacts/api-server/apps-script/` |
| AI/LLM | Anthropic Claude API | card intel |
| Images | remove.bg API + Cloudinary upload | `src/routes/upload.ts` |
| Card data | Scryfall API (per-rarity counts, pricing) | `src/routes/scryfall.ts` |

---

## Integrations & MCPs  [rewrite — auto-generated from MCP config files]

| Integration | Purpose | Cost | Status |
|---|---|---|---|
| Stripe | Checkout + webhooks | usage-based | live |
| Shippo | USPS shipping rates | usage-based | live |
| Google Apps Script | Append orders to a Sheet | free | live |
| Anthropic Claude | Card intel | usage-based | live |
| remove.bg | Background removal for product images | usage-based | live |
| Cloudinary | Image upload/hosting | unknown | live |
| Scryfall | Per-rarity card counts + pricing for pull odds | free | live |
| Supabase | Postgres + auth (magic-link / token validation) | unknown | live |

*Source: no MCP config files found in repo. Table built from `.env.example` keys, README, and route code — not MCP configs.*

---

## Decisions log  [append-only — never rewrite or delete]

- **2026-06-12 — Pull-probability source of truth = auto-derive** — Tier and per-card odds are computed from each product's official pack-contents text + live Scryfall per-rarity counts, not manual entry. Rejected hand-typed numbers because they were inaccurate/fabricated.
- **2026-06-12 — Tier % means per-pack hit rate** — A tier's percentage is the chance a pack contains ≥1 card of that tier, not its share of the pack. Consequence: tier numbers don't sum to 100, so the donut chart was removed in favor of hit-rate bars.
- **2026-06-12 — Rare/mythic split via WotC 2:1 convention** — The rare-vs-mythic ratio isn't in any source, so we apply WotC's documented sheet convention (a rare prints ~2x as often as a mythic), automatically, to all products. Deliberate call by Finley.

---

## Open loops  [rewrite — but carry forward unfinished items]

- [ ] Deploy frontend + backend together — Finley (old donut FE + new hit-rate data breaks the storefront visual)
- [ ] After deploy, click "Re-lock pull odds" once to upgrade all existing products (TMNT included) — Finley
- [ ] Phase 2: decide which cards show as "possible pulls," plus their images and ordering (currently top-N by USD from Scryfall) — Finley
- [ ] Handle cards whose stored subtitle lacks a standard rarity word — they keep their prior value in re-pricing (e.g. TMNT borderless Eastman cards stay <1%)

---

## Risks & known issues  [rewrite]

- **No migration system.** Schema changes must be idempotent `ALTER TABLE` in the API-server bootstrap or prod drifts and 500s (previously caused orders to silently not persist).
- **FE/BE deploy coupling (this release).** Shipping per-pack hit-rate data while an old donut frontend is live renders numbers summing >300% and breaks the storefront.
- **CORS / FRONTEND_URL gotcha.** Multi-origin CORS is comma-separated `FRONTEND_URL`; misconfiguration was behind a prior incident. www-canonical domain.
- **Mac dev friction.** Repo is configured Linux-only (`pnpm-workspace.yaml` overrides strip all non-linux native binaries). To run the frontend on a Mac, temporarily un-exclude darwin-arm64 builds of rollup/lightningcss/@tailwindcss/oxide/esbuild, `pnpm install`, then revert (node_modules keeps the binaries). The API server won't boot locally without a real `DATABASE_URL` — the local `.env` placeholder fails the boot-time DB migration.
- **`.env.example` secret hygiene.** Real production secrets have been pasted into `.env.example` before; check it whenever env vars change.
- **Railway deploys are manual.**

---

## Links  [rewrite]

- **Live URL:** https://tommytopdecker.com (Vercel, www-canonical)
- **Staging:** (none yet)
- **API host:** Railway (manual deploys)
- **Client Drive folder:** (unknown)
- **Slack channel:** (none known)
- **GitHub org:** Kuba-Ventures
- **Related repos:** (none known)

---

## Changelog  [append-only — never rewrite or delete]

- **2026-06-12:** Initial PROJECT.md superdoc. Recorded pull-probabilities phase 1 (per-pack hit rates derived from pack contents + Scryfall, 2:1 rare/mythic split, locked per-card odds, re-lock backfill endpoint + admin button), the Scryfall User-Agent fix, the FE/BE co-deploy requirement, and Mac/Linux dev-env notes.
