# Nemat / Tommy Top Decker Trading
*Magic: The Gathering booster-pack drop storefront with live shipping, Stripe checkout, and an admin panel.*

*Last updated: 2026-06-12 23:59 ET by kuba-vault*

---

## TL;DR  [rewrite]

Tommy Top Decker Trading is a single-product-at-a-time MTG booster-pack drop site: browse a product, get a live USPS quote, check out with Stripe, and the order lands in Postgres and a Google Sheet. It's live, in post-MVP iteration. The pull-probabilities feature now shows a full pack picture: the 5 most valuable chase cards (any rarity) followed by a sampling of the set's nicest uncommons (3) and commons (2), each with accurate per-card odds, all auto-derived from pack contents + live Scryfall data (latest on master as `a065659`). Possible Pulls is auto-managed, not curated. The code is live (Railway auto-deploys the backend on master pushes, Vercel the frontend), but the production DB's TMNT product still holds stale seed odds and an empty `possiblePulls`, so the live storefront is rendering mock fallback for that product. The one thing left: Finley clicks "Re-lock pull odds" in the live admin to write the accurate tiers + 10-card lineup into the DB.

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
- **Next milestone:** click "Re-lock pull odds" on the live admin to refresh the production DB (TMNT still has stale seed odds + empty possiblePulls)
- **Flags:** shipping

---

## Where we are right now  [rewrite]

Just shipped to master (`a065659`, backend auto-deploying via Railway, frontend via Vercel): Possible Pulls now shows common/uncommon cards below the top-5 chase cards, so the storefront reflects the whole pack instead of just the marquee. `buildPossiblePulls` in `artifacts/api-server/src/routes/scryfall.ts` composes the showcase as TOP_VALUE_COUNT=5 chase cards (most valuable, any rarity) + UNCOMMON_COUNT=3 + COMMON_COUNT=2, each value-ranked within its rarity and deduped by name. Key refinement this session: the stated special-treatment rate (e.g. `<1%`) is now applied ONLY to rare/mythic chase printings — a borderless *uncommon* keeps its standard ~6.2% odds instead of being mislabeled ultra-rare. The `buildPossiblePulls` signature changed (dropped the explicit limit arg); the lookup route and the relock backfill in `products.ts` were updated to match. `PossiblePullsGrid.tsx` renders a small "Also in every pack" divider (label + thin rule, col-span-full) before the first common/uncommon card. Verified against live TMNT (`tmt`): chase = Leonardo Sewer Samurai / Donatello Mutant Mechanic / Raphael Ninja Destroyer / Michelangelo Improviser (Borderless) + Super Shredder (Full Art), all `<1%`; then uncommons (~6.2%) Michelangelo Mutant BFF, Skateboard, Leonardo Leader in Blue; then commons (~7.4%) Sewer-veillance Cam, Negate. Discovered this session: the production DB's TMNT product still has the OLD seed `pullProbabilities` (27/23/22/14/9/5, no display field) and an EMPTY `possiblePulls`, so the live storefront is currently rendering the mock fallback and stale tier numbers. The only remaining step is for Finley to click "Re-lock pull odds" in the live admin once deploys land — that writes the accurate tiers + 10-card lineup into the DB. (Confirmed the Railway backend auto-deploys from master: the relock-pulls endpoint returns 401 live, i.e. the new code is present — correcting the earlier "Railway deploys are manual" note.)

---

## What's built  [rewrite]

**Frontend / UI** (`artifacts/nemat-drop`, Vite/React → Vercel)
- Storefront product page with live USPS shipping quotes and Stripe checkout (`src/pages/checkout.tsx`, `success.tsx`).
- Customer accounts: email+password login with magic-link fallback, order history (`src/pages/account.tsx`).
- Admin panel (`src/pages/admin.tsx`): unified top nav (Storefront link + Products / Orders / Waitlist tabs), hidden admin entry; product management, order + waitlist dashboards, Stripe order backfill/sync, and a new "Re-lock pull odds" button.
- Pull-probability chart now renders per-pack hit-rate bars; the donut was removed because hit rates don't sum to 100 (`src/components/PullProbabilityChart.tsx`).
- "Possible Pulls" shows the top-5 chase cards followed by a sampling of uncommons (3) and commons (2), each with image + rarity + accurate per-card odds, sourced straight from the backend `possiblePulls`; the old hardcoded 8-card mapping was removed (`src/pages/admin.tsx`). A small "Also in every pack" divider separates the chase row from the everyday pulls (`src/components/PossiblePullsGrid.tsx`).
- Mock fallback data updated to the real TMNT 10-card lineup (`src/data/product.ts`).

**Backend / data** (`artifacts/api-server`, Express 5 + TS → Railway)
- Routes: `account`, `checkout`, `orders`, `products`, `scryfall`, `shipping`, `subscribers`, `upload`, `webhooks`, `health`.
- Probability model in `src/routes/scryfall.ts`: `computePullData` (now also returns parsed `specials`), `fetchRarityCounts`, `perCardOdds`, set-resolution helpers (`parseTcgSlug`, `matchScryfallSet`, `resolveSetFromTcgUrl`), and the `scryfallFetch()` wrapper.
- Possible-pulls selector in `src/routes/scryfall.ts`: `fetchTopCardsByValue` (set cards ranked by Scryfall USD desc, basic lands excluded, `unique=prints`) and `buildPossiblePulls`, which composes the showcase from `TOP_VALUE_COUNT=5` chase cards (any rarity) + `UNCOMMON_COUNT=3` + `COMMON_COUNT=2`, each value-ranked within rarity and deduped by name. Attaches image + rarity + locked odds; detects borderless/showcase/full-art via `treatmentOf` and applies the set's stated special rate ONLY to rare/mythic chase printings (so a borderless uncommon keeps its standard odds). Lineup composition is tunable via the three count constants.
- Admin endpoint `POST /api/admin/products/relock-pulls` in `src/routes/products.ts` — idempotent backfill that recomputes per-card odds AND regenerates the `possiblePulls` lineup for every existing product (auto-managed); updated to the new `buildPossiblePulls` signature.
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

- **2026-06-12 — Possible Pulls shows chase + everyday cards, not just the top-5** — The lineup is now 5 most-valuable chase cards (any rarity) + 3 uncommons + 2 commons, value-ranked within rarity, so buyers see the whole pack rather than just the marquee. Composition is tunable via `TOP_VALUE_COUNT` / `UNCOMMON_COUNT` / `COMMON_COUNT` in `scryfall.ts`.
- **2026-06-12 — Special-treatment rate applies only to rare/mythic chase printings** — The set's stated special rate (e.g. `<1%`) is no longer applied to special-treatment uncommons/commons; a borderless uncommon keeps its standard ~6.2% odds instead of being mislabeled ultra-rare. Refines the earlier "label all special printings with the special rate" decision.
- **2026-06-12 — Possible Pulls is auto-managed, not curated** — "Possible Pulls" always shows the live top-5 most valuable distinct cards by Scryfall USD; "Re-lock pull odds" replaces whatever's stored. Finley chose "auto-managed" over a "seed-then-preserve" model where manual edits would survive a re-lock.
- **2026-06-12 — Special printings labeled with the set's stated special rate** — Borderless/showcase/full-art cards (detected via `treatmentOf`) are labeled with the set's stated special rate (e.g. `<1%`) rather than standard rarity odds, which would overstate them. Approximation accepted: one rate covers all special-treatment cards (see Risks).
- **2026-06-12 — Pull-probability source of truth = auto-derive** — Tier and per-card odds are computed from each product's official pack-contents text + live Scryfall per-rarity counts, not manual entry. Rejected hand-typed numbers because they were inaccurate/fabricated.
- **2026-06-12 — Tier % means per-pack hit rate** — A tier's percentage is the chance a pack contains ≥1 card of that tier, not its share of the pack. Consequence: tier numbers don't sum to 100, so the donut chart was removed in favor of hit-rate bars.
- **2026-06-12 — Rare/mythic split via WotC 2:1 convention** — The rare-vs-mythic ratio isn't in any source, so we apply WotC's documented sheet convention (a rare prints ~2x as often as a mythic), automatically, to all products. Deliberate call by Finley.

---

## Open loops  [rewrite — but carry forward unfinished items]

- [ ] Click "Re-lock pull odds" on the live admin once deploys finish — Finley. The production DB's TMNT product still has the old seed `pullProbabilities` (27/23/22/14/9/5) and empty `possiblePulls`, so the live storefront renders mock fallback + stale tiers. This is the only thing left to make the live site fully accurate.
- [x] Deploy frontend + backend — code is on master (`a065659`); Railway + Vercel auto-deploy from master pushes.
- [x] Possible-pulls chase + everyday lineup — done in `a065659` (top-5 chase + 3 uncommons + 2 commons, accurate per-card odds).
- [x] Possible-pulls card selection — done in `972eb22` (auto-managed top-5 by USD, with images, rarity, and locked odds).

---

## Risks & known issues  [rewrite]

- **No migration system.** Schema changes must be idempotent `ALTER TABLE` in the API-server bootstrap or prod drifts and 500s (previously caused orders to silently not persist).
- **Live prod DB has stale TMNT pull data.** The production DB's TMNT product still holds the old seed `pullProbabilities` (27/23/22/14/9/5, no display field) and an EMPTY `possiblePulls`, so the live storefront renders the mock fallback for Possible Pulls and stale tier numbers in the chart. Fix: one "Re-lock pull odds" admin run now that the new code is deployed. Until then, the live site does not match what's verified locally.
- **Special-printing odds are approximate.** The set's stated special rate is now applied only to rare/mythic chase printings (a borderless uncommon keeps its standard odds), but it's still one rate across all rare/mythic special treatments — a full-art Super Shredder shows the same `<1%` as a borderless headliner, not a per-treatment exact rate. Sets with no stated special % fall back to standard rarity odds for special cards.
- **CORS / FRONTEND_URL gotcha.** Multi-origin CORS is comma-separated `FRONTEND_URL`; misconfiguration was behind a prior incident. www-canonical domain.
- **Mac dev friction.** Repo is configured Linux-only (`pnpm-workspace.yaml` overrides strip all non-linux native binaries). To run the frontend on a Mac, temporarily un-exclude darwin-arm64 builds of rollup/lightningcss/@tailwindcss/oxide/esbuild, `pnpm install`, then revert (node_modules keeps the binaries). The API server won't boot locally without a real `DATABASE_URL` — the local `.env` placeholder fails the boot-time DB migration.
- **`.env.example` secret hygiene.** Real production secrets have been pasted into `.env.example` before; check it whenever env vars change.

---

## Links  [rewrite]

- **Live URL:** https://tommytopdecker.com (Vercel, www-canonical)
- **Staging:** (none yet)
- **API host:** Railway (auto-deploys from master pushes)
- **Client Drive folder:** (unknown)
- **Slack channel:** (none known)
- **GitHub org:** Kuba-Ventures
- **Related repos:** (none known)

---

## Changelog  [append-only — never rewrite or delete]

- **2026-06-12:** Possible Pulls chase + everyday lineup (`a065659`) — `buildPossiblePulls` now composes top-5 chase cards (any rarity) + 3 uncommons + 2 commons, value-ranked within rarity, with accurate per-card odds; the special rate now applies only to rare/mythic chase printings (borderless uncommons keep ~6.2%). New "Also in every pack" divider in `PossiblePullsGrid`; TMNT mock is now a 10-card lineup. Confirmed Railway auto-deploys from master (relock endpoint 401 live = new code present) — corrects the "Railway deploys are manual" note. Noted: prod DB's TMNT product still has stale seed odds + empty possiblePulls; one "Re-lock pull odds" run will fix the live site.
- **2026-06-12:** Pull-probabilities phase 2 (`972eb22`) — "Possible Pulls" now auto-selects the top-5 most valuable distinct cards per set (`fetchTopCardsByValue` + `buildPossiblePulls`), with images, rarity, and locked odds; special printings detected via `treatmentOf` and labeled with the set's stated special rate. Re-lock now also regenerates the top-5 (auto-managed). Admin uses backend `possiblePulls` directly; TMNT mock updated to the real top-5. Phase 2 complete; both phases now done pending deploy.
- **2026-06-12:** Initial PROJECT.md superdoc. Recorded pull-probabilities phase 1 (per-pack hit rates derived from pack contents + Scryfall, 2:1 rare/mythic split, locked per-card odds, re-lock backfill endpoint + admin button), the Scryfall User-Agent fix, the FE/BE co-deploy requirement, and Mac/Linux dev-env notes.
