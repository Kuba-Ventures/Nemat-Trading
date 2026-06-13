# Nemat / Tommy Top Decker Trading
*Magic: The Gathering booster-pack drop storefront with live shipping, Stripe checkout, and an admin panel.*

*Last updated: 2026-06-12 20:51 ET by kuba-vault*

---

## TL;DR  [rewrite]

Tommy Top Decker Trading is a single-product-at-a-time MTG booster-pack drop site: browse a product, get a live USPS quote, check out with Stripe, and the order lands in Postgres and a Google Sheet. It's live, in post-MVP iteration. The pull-probabilities feature is now complete across both phases: phase 1 derived accurate per-pack hit rates and locked per-card odds from each product's pack contents plus live Scryfall counts; phase 2 (committed to master as `972eb22`) auto-selects the 5 most valuable distinct cards per set as "Possible Pulls," each with image, rarity, and locked odds. Possible Pulls is auto-managed — always the live top-5 by value — not manually curated. Frontend and backend still must deploy together, and someone must click "Re-lock pull odds" once after deploy to refresh stored odds and the top-5 selection.

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
- **Next milestone:** deploy FE+BE together and run "Re-lock pull odds" once to push both phases live
- **Flags:** shipping

---

## Where we are right now  [rewrite]

Phase 2 of pull-probabilities just landed on master (`972eb22`). "Possible Pulls" now auto-selects the 5 most valuable distinct cards in each product's set, carrying the locked per-card odds from phase 1. The backend selector lives in `artifacts/api-server/src/routes/scryfall.ts`: `fetchTopCardsByValue` ranks set cards by Scryfall USD desc (basic lands excluded, `unique=prints`), and `buildPossiblePulls` de-dupes by name keeping the priciest printing, takes the top 5, and attaches image + rarity + locked odds. Special printings (borderless / showcase / full-art) are detected via `treatmentOf` and labeled with the set's stated special rate (e.g. `<1%`) instead of overstating them with standard rarity odds. The `relock-pulls` backfill (`products.ts`) now regenerates `possiblePulls` from this selector, so clicking "Re-lock pull odds" refreshes both the odds and the top-5 selection — this is auto-managed by design, not seed-then-preserve. Admin lookup (`admin.tsx`) uses the backend `possiblePulls` directly (the old hardcoded 8-card mapping is gone), and the `product.ts` mock now reflects the real TMNT top-5. Verified against live TMNT data (`tmt`): Leonardo Sewer Samurai, Donatello Mutant Mechanic, Raphael Ninja Destroyer, Michelangelo Improviser (all Borderless) and Super Shredder (Full Art), all labeled `<1%` — the marquee chase cards. Next concrete step is unchanged: deploy frontend and backend together (old donut FE + new per-pack data breaks the storefront), then click "Re-lock pull odds" once to upgrade every existing product including TMNT. With phase 2 done, both phases of the pull-probabilities feature are complete; the only remaining work is the deploy itself.

---

## What's built  [rewrite]

**Frontend / UI** (`artifacts/nemat-drop`, Vite/React → Vercel)
- Storefront product page with live USPS shipping quotes and Stripe checkout (`src/pages/checkout.tsx`, `success.tsx`).
- Customer accounts: email+password login with magic-link fallback, order history (`src/pages/account.tsx`).
- Admin panel (`src/pages/admin.tsx`): unified top nav (Storefront link + Products / Orders / Waitlist tabs), hidden admin entry; product management, order + waitlist dashboards, Stripe order backfill/sync, and a new "Re-lock pull odds" button.
- Pull-probability chart now renders per-pack hit-rate bars; the donut was removed because hit rates don't sum to 100 (`src/components/PullProbabilityChart.tsx`).
- "Possible Pulls" shows the auto-selected top-5 most valuable distinct cards per set (image + rarity + locked odds), sourced straight from the backend `possiblePulls`; the old hardcoded 8-card mapping was removed (`src/pages/admin.tsx`).
- Mock fallback data updated to the real TMNT top-5 (`src/data/product.ts`).

**Backend / data** (`artifacts/api-server`, Express 5 + TS → Railway)
- Routes: `account`, `checkout`, `orders`, `products`, `scryfall`, `shipping`, `subscribers`, `upload`, `webhooks`, `health`.
- Probability model in `src/routes/scryfall.ts`: `computePullData` (now also returns parsed `specials`), `fetchRarityCounts`, `perCardOdds`, set-resolution helpers (`parseTcgSlug`, `matchScryfallSet`, `resolveSetFromTcgUrl`), and the `scryfallFetch()` wrapper.
- Possible-pulls selector in `src/routes/scryfall.ts`: `fetchTopCardsByValue` (set cards ranked by Scryfall USD desc, basic lands excluded, `unique=prints`) and `buildPossiblePulls` (de-dupes by name keeping the priciest printing, takes top 5, attaches image + rarity + locked odds; detects borderless/showcase/full-art via `treatmentOf` and labels them with the set's stated special rate).
- Admin endpoint `POST /api/admin/products/relock-pulls` in `src/routes/products.ts` — idempotent backfill that recomputes per-card odds AND regenerates the top-5 `possiblePulls` selection for every existing product (auto-managed).
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

- **2026-06-12 — Possible Pulls is auto-managed, not curated** — "Possible Pulls" always shows the live top-5 most valuable distinct cards by Scryfall USD; "Re-lock pull odds" replaces whatever's stored. Finley chose "auto-managed" over a "seed-then-preserve" model where manual edits would survive a re-lock.
- **2026-06-12 — Special printings labeled with the set's stated special rate** — Borderless/showcase/full-art cards (detected via `treatmentOf`) are labeled with the set's stated special rate (e.g. `<1%`) rather than standard rarity odds, which would overstate them. Approximation accepted: one rate covers all special-treatment cards (see Risks).
- **2026-06-12 — Pull-probability source of truth = auto-derive** — Tier and per-card odds are computed from each product's official pack-contents text + live Scryfall per-rarity counts, not manual entry. Rejected hand-typed numbers because they were inaccurate/fabricated.
- **2026-06-12 — Tier % means per-pack hit rate** — A tier's percentage is the chance a pack contains ≥1 card of that tier, not its share of the pack. Consequence: tier numbers don't sum to 100, so the donut chart was removed in favor of hit-rate bars.
- **2026-06-12 — Rare/mythic split via WotC 2:1 convention** — The rare-vs-mythic ratio isn't in any source, so we apply WotC's documented sheet convention (a rare prints ~2x as often as a mythic), automatically, to all products. Deliberate call by Finley.

---

## Open loops  [rewrite — but carry forward unfinished items]

- [ ] Deploy frontend + backend together — Finley (old donut FE + new hit-rate data breaks the storefront visual)
- [ ] After deploy, click "Re-lock pull odds" once to refresh both odds and the top-5 selection on all existing products (TMNT included) — Finley
- [x] Phase 2: possible-pulls card selection — done in `972eb22` (auto-managed top-5 by USD, with images, rarity, and locked odds)

---

## Risks & known issues  [rewrite]

- **No migration system.** Schema changes must be idempotent `ALTER TABLE` in the API-server bootstrap or prod drifts and 500s (previously caused orders to silently not persist).
- **FE/BE deploy coupling (this release).** Shipping per-pack hit-rate data while an old donut frontend is live renders numbers summing >300% and breaks the storefront. Both pull-probability phases must go out together, followed by one "Re-lock pull odds" run.
- **Special-printing odds are approximate.** The `<1%` rate applied to special-treatment cards uses the set's single stated special rate for ANY special-treatment card, so a full-art Super Shredder shows the same `<1%` as a borderless headliner — closer than before but not a per-treatment exact rate. Sets with no stated special % fall back to standard rarity odds for special cards.
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

- **2026-06-12:** Pull-probabilities phase 2 (`972eb22`) — "Possible Pulls" now auto-selects the top-5 most valuable distinct cards per set (`fetchTopCardsByValue` + `buildPossiblePulls`), with images, rarity, and locked odds; special printings detected via `treatmentOf` and labeled with the set's stated special rate. Re-lock now also regenerates the top-5 (auto-managed). Admin uses backend `possiblePulls` directly; TMNT mock updated to the real top-5. Phase 2 complete; both phases now done pending deploy.
- **2026-06-12:** Initial PROJECT.md superdoc. Recorded pull-probabilities phase 1 (per-pack hit rates derived from pack contents + Scryfall, 2:1 rare/mythic split, locked per-card odds, re-lock backfill endpoint + admin button), the Scryfall User-Agent fix, the FE/BE co-deploy requirement, and Mac/Linux dev-env notes.
