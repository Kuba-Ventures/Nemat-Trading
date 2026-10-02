# Nemat / Tommy Top Decker Trading
*MTG booster-pack drop storefront with honest pull odds and Stripe checkout.*

*Last updated: 2026-10-02 12:08 ET by kuba-vault*

---

## TL;DR  [rewrite]

Tommy Top Decker Trading sells one MTG booster-pack drop at a time at tommytopdecker.com: derived pull odds, live USPS quotes, Stripe checkout. It's live and taking orders from a Meta ad campaign that started 2026-09-28. Since June it gained Resend order emails (sales alert plus a pack-themed customer confirmation), Meta click id and UTM attribution on every order, and Vitest in the frontend. Today PR #102 fixed the broken factory review gate by pinning the review action to a known-good SHA. Next: prove the gate on a real code PR so issue #96 can close, then surface attribution in the admin.

---

## What it is  [rewrite when value prop evolves]

**The problem:** Buyers of MTG booster packs can't see real odds of pulling a given rarity or card; sellers either omit odds or make them up.
**The solution:** A drop storefront that shows pull probabilities derived from pack contents and live Scryfall data, with live shipping quotes and Stripe checkout.
**The user:** MTG collectors buying single curated booster-pack drops.
**The value:** Sourced odds plus a clean buy-and-ship flow, one featured product at a time.

---

## Status  [rewrite]

- **Phase:** live (post-MVP iteration)
- **Engagement manager:** self-directed
- **Lead:** Finley
- **Cadence:** self-directed
- **Next milestone:** a code PR gets a factory verdict on the pinned action, then close #96 (TBD, next code PR)
- **Flags:** on-track

---

## Where we are right now  [rewrite]

PR #102 merged today. It found the real cause of the factory-review outage: the floating `anthropics/claude-code-action@v1` tag moved to a broken release (v1.0.236) on 2026-09-28. The OAuth token was fine; it was never rotated and worked before and after. The action is now pinned to the v1.0.239 SHA (`97c53473`). The enforce step runs on failure, so a failed review now labels and comments. CI-change detection no longer fails open. Two backstops downgrade an approval to ESCALATE: `reviewer_completed` must be true, and every changed file must sit inside the low-risk paths. `CLAUDE.md` and `.claude/**` always escalate. Jobs have 20 min timeouts, the review step 15 min. #96 stays open until the next code PR shows a verdict, `num_turns` above 1, and a label. Separately, #93 to #99 were merged by hand on 2026-09-28 with no factory verdict, so they never got a review.

---

## What's built  [rewrite]

**Frontend / UI** (`artifacts/nemat-drop`, Vite/React on Vercel)
- Storefront product page, live USPS quotes, Stripe checkout and success page (`src/pages/checkout.tsx`, `src/pages/success.tsx`). Phone layout fix for the order card (#97).
- Customer accounts via Supabase auth: email+password with magic-link fallback, order history (`src/pages/account.tsx`, `src/lib/supabase.ts`).
- Admin panel (`src/pages/admin.tsx`): products, orders, waitlist, Stripe order backfill, "Re-lock pull odds".
- Pull odds as per-pack hit-rate bars (`src/components/PullProbabilityChart.tsx`) and an auto-managed Possible Pulls lineup (`src/components/PossiblePullsGrid.tsx`).
- Rolling 10-day drop deadline, one countdown per screen, mobile purchase bar (#76, #77, #86).
- Share card and page metadata (#82); contrast and form-label fixes (#80, #83).
- GTM container with real Purchase value pushed to `dataLayer` on `/success` (`index.html`, #60).
- Attribution capture (`src/lib/attribution.ts`, #100): saves `fbclid` and `utm_*` on landing (last touch, 28 days) and sends them plus `_fbc`/`_fbp` with checkout.
- Vitest suite (`vitest run`, jsdom) so frontend PRs can clear factory gate 3 (#98, #99).

**Backend / data** (`artifacts/api-server`, Express 5 + TS on Railway)
- Routes: `account`, `checkout`, `orders`, `products`, `scryfall`, `shipping`, `subscribers`, `upload`, `webhooks`, `health`.
- Max 2 per item per order, enforced server-side (`src/routes/checkout.ts`).
- Order emails via Resend from the Stripe webhook (`src/lib/orderEmail.ts`, #93 to #95): a new-order alert to sales and an instant pack-themed confirmation to the buyer. Skipped if `RESEND_API_KEY` is unset.
- Attribution (`src/lib/attribution.ts`, #100): checkout whitelists and caps the keys, stores them in Stripe metadata (`attr_` prefix), and the webhook copies them to 9 new nullable columns on `orders`. The order APIs don't return them yet.
- Pull-odds model and Possible Pulls selector in `src/routes/scryfall.ts`; `POST /api/admin/products/relock-pulls` backfill in `src/routes/products.ts`.
- One shared TCGPlayer price figure, no seed fallback (`src/lib/tcg-pricing.ts`, #65, #66).
- Google Sheets sync via Apps Script (`src/lib/sheets.ts`, `apps-script/`).
- Schema changes as idempotent `ALTER TABLE` in the bootstrap (`src/index.ts`), which also enables RLS on all tables to block Supabase's public Data API.
- Tests: `tsx --test` (attribution, drop window, order email, TCG pricing).

**Infrastructure**
- pnpm monorepo (pnpm 10.33.0). Shared libs: `lib/db` (Drizzle + pg), `lib/api-zod`, `lib/api-client-react`, `lib/api-spec` (OpenAPI + Orval).
- Supervised PR factory (`.github/workflows/factory.yml`, `.claude/agents/pr-reviewer.md`): low-risk paths can auto-merge, everything else escalates. Review action pinned to v1.0.239 SHA as of #102.
- Google Ads MCP setup docs and scripts, local and Cloud Run (`docs/google-ads-mcp.md`, `scripts/setup-google-ads-mcp.sh`, `scripts/deploy-google-ads-mcp-cloudrun.sh`).
- `ROADMAP.md` (#101) tracks staged work; cross-reference it for anything not covered here.

---

## Tech stack  [rewrite, scanned from package.json / pnpm-workspace.yaml]

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Vite 7 + React 19 + Tailwind 4, Radix UI, TanStack Query, framer-motion | `artifacts/nemat-drop`, Vercel |
| Backend | Express 5 + TypeScript (tsx) | `artifacts/api-server`, Railway |
| Database | PostgreSQL + Drizzle ORM, Supabase-hosted (per code; see Risks) | `lib/db`, bootstrap in `artifacts/api-server/src/index.ts` |
| Auth | Supabase auth (customers), `x-admin-key` (admin API) | `src/lib/supabaseAuth.ts` |
| Payments | Stripe Checkout + webhooks | `src/routes/checkout.ts`, `src/routes/webhooks.ts` |
| Email | Resend | `src/lib/orderEmail.ts` |
| Shipping | Shippo (USPS rates) | `src/routes/shipping.ts` |
| Tracking | Google Tag Manager | `artifacts/nemat-drop/index.html` |
| AI/LLM | Anthropic Claude API (card intel); claude-code-action (PR review) | `src/routes/scryfall.ts`, `.github/workflows/factory.yml` |
| Tests | `tsx --test` (API), Vitest 4 + jsdom 26 (frontend) | |

---

## Integrations & MCPs  [rewrite, auto-generated from MCP config files]

| Integration | Purpose | Cost | Status |
|---|---|---|---|
| Stripe | Checkout + webhooks | usage-based | live |
| Shippo | USPS shipping rates | usage-based | live |
| Resend | Order alert + customer confirmation emails | unknown | live |
| Supabase | Postgres + customer auth | unknown | live |
| Google Apps Script | Append orders and signups to a Sheet | free | live |
| Google Tag Manager | Purchase value to `dataLayer` | free | live |
| Anthropic Claude | Card intel; factory PR review | usage-based | live |
| remove.bg | Background removal for product images | usage-based | live |
| Cloudinary | Browser-direct admin image upload | unknown | live (optional) |
| Scryfall | Per-rarity card counts + pricing for pull odds | free | live |
| Google Ads MCP | Ads access for Claude clients (docs + scripts only) | unknown | documented |

*Source: no MCP configs found in repo. Table built from `.env.example` keys, route code, `index.html`, `factory.yml` and `docs/google-ads-mcp.md`.*

---

## Decisions log  [append-only, never rewrite or delete]

- **2026-10-02, Pin the factory review action to a SHA**. The floating `@v1` tag broke the gate on 2026-09-28 with no change in this repo. Pinned to `97c53473` (v1.0.239); bumps go in their own PR. Rejected rotating the OAuth token, since evidence showed the token never failed.
- **2026-10-02, Policy files always escalate**. `CLAUDE.md` and `.claude/**` matched the `**/*.md` low-risk surface, so the policy could approve edits to itself. They now escalate in both the path check and the policy text.
- **2026-10-02, Backstops only downgrade verdicts**. APPROVE-LOWRISK drops to ESCALATE if `reviewer_completed` isn't true or any file falls outside low-risk paths. Neither check can upgrade a verdict.
- **2026-10-01, Attribution rides Stripe metadata**. Click ids and UTMs go into Stripe session metadata and get copied to the order row by the webhook, so the money path stays unchanged and old clients still work.
- **2026-09-28, Order emails sent from the API via Resend**. Sends straight from the webhook rather than relying on Stripe's receipt, which can arrive minutes later.
- **2026-08-12, Revert direct Meta Pixel + CAPI; use GTM**. The direct Pixel + CAPI code (#58) was reverted (#59); Purchase value now goes through GTM's `dataLayer` (#60).
- **2026-06-12, Possible Pulls shows chase + everyday cards, not just the top-5**. The lineup is now 5 most-valuable chase cards (any rarity) + 3 uncommons + 2 commons, value-ranked within rarity, so buyers see the whole pack rather than just the marquee. Composition is tunable via `TOP_VALUE_COUNT` / `UNCOMMON_COUNT` / `COMMON_COUNT` in `scryfall.ts`.
- **2026-06-12, Special-treatment rate applies only to rare/mythic chase printings**. The set's stated special rate (e.g. `<1%`) is no longer applied to special-treatment uncommons/commons; a borderless uncommon keeps its standard ~6.2% odds instead of being mislabeled ultra-rare. Refines the earlier "label all special printings with the special rate" decision.
- **2026-06-12, Possible Pulls is auto-managed, not curated**. "Possible Pulls" always shows the live top-5 most valuable distinct cards by Scryfall USD; "Re-lock pull odds" replaces whatever's stored. Finley chose "auto-managed" over a "seed-then-preserve" model where manual edits would survive a re-lock.
- **2026-06-12, Special printings labeled with the set's stated special rate**. Borderless/showcase/full-art cards (detected via `treatmentOf`) are labeled with the set's stated special rate (e.g. `<1%`) rather than standard rarity odds, which would overstate them. Approximation accepted: one rate covers all special-treatment cards (see Risks).
- **2026-06-12, Pull-probability source of truth = auto-derive**. Tier and per-card odds are computed from each product's official pack-contents text + live Scryfall per-rarity counts, not manual entry. Rejected hand-typed numbers because they were inaccurate/fabricated.
- **2026-06-12, Tier % means per-pack hit rate**. A tier's percentage is the chance a pack contains ≥1 card of that tier, not its share of the pack. Consequence: tier numbers don't sum to 100, so the donut chart was removed in favor of hit-rate bars.
- **2026-06-12, Rare/mythic split via WotC 2:1 convention**. The rare-vs-mythic ratio isn't in any source, so we apply WotC's documented sheet convention (a rare prints ~2x as often as a mythic), automatically, to all products. Deliberate call by Finley.

---

## Open loops  [rewrite, but carry forward unfinished items]

- [ ] Open a code PR and confirm the factory posts a verdict comment, logs `num_turns` above 1, and sets a label; then close #96. Owner: Finley
- [ ] Decide whether to retro-review #93 to #99, which were hand-merged on 2026-09-28 without a factory verdict. Owner: Finley
- [ ] Return the attribution columns from `/admin/orders` and show them in the admin (ROADMAP Stage 2). Owner: Finley
- [ ] Put `/scryfall/:id/price`, `/tcgplayer/*` and `/lookup/tcgplayer` behind `requireAdmin` in `src/routes/scryfall.ts`. Owner: Finley
- [ ] Fix `README.md`: it says Postgres runs on Railway, but the code targets Supabase. It also omits the Resend and Supabase env vars. Owner: Finley
- [ ] Update ROADMAP.md Stage 3: it still names an expired OAuth token as the likely cause, and its "pin the action" open question is now answered. Owner: Finley
- [ ] Confirm "Re-lock pull odds" has run on production. PROJECT.md listed it as the last step in June and nothing in the repo records it. Waiting on: Finley
- [ ] Pick the next drop after TMNT and a drop cadence. Waiting on: Finley

---

## Risks & known issues  [rewrite]

- **Unreviewed merges.** #93 to #99 (order emails, checkout fix, Vitest) went to master by hand with no factory verdict. They touch the webhook and checkout.
- **Factory fix not yet proven.** #102 changed the workflow itself, so it escalated without a review. Nothing confirms the pinned action returns a verdict on a code PR yet.
- **Public lookup routes.** `/scryfall/:id/price`, `/tcgplayer/price`, `/tcgplayer/price-check`, `/tcgplayer/debug` and `/lookup/tcgplayer` have no auth. Only `intel-report/restyle` and `remove-background` use `requireAdmin`.
- **DB host docs conflict.** `README.md` says Railway Postgres. `CLAUDE.md`, the RLS lockdown in `src/index.ts` (written for Supabase's Data API) and PR #1 point to Supabase. Code evidence favors Supabase; the live `DATABASE_URL` wasn't checked.
- **Attribution not visible yet.** Since the campaign launched on 2026-09-28, Meta credits no orders to the ads (per #100). The new columns fill on new orders, but you can only read them with SQL until the admin shows them.
- **No migration system.** Schema changes must be idempotent `ALTER TABLE` in the API bootstrap or prod drifts and 500s (this previously caused orders to silently not persist).
- **Admin password is client-side.** `VITE_ADMIN_PASSWORD` ships in the browser bundle; real protection is `ADMIN_SECRET` on the server.
- **Ephemeral uploads.** Server-side uploads land on Railway's local disk and vanish on redeploy; Cloudinary is optional.
- **Special-printing odds are approximate.** One stated special rate covers all rare/mythic special treatments.
- **CORS / FRONTEND_URL gotcha.** Multi-origin CORS is comma-separated `FRONTEND_URL`; a misconfiguration caused a prior incident. Domain is www-canonical.
- **Mac dev friction.** `pnpm-workspace.yaml` strips non-Linux native binaries, so frontend tests and dev need a temporary darwin override. The API won't boot locally without a real `DATABASE_URL`.
- **`.env.example` secret hygiene.** Real production secrets have been pasted into `.env.example` before, and the repo is public. Check it whenever env vars change.

---

## Links  [rewrite]

- **Live URL:** https://tommytopdecker.com (Vercel, www-canonical)
- **Staging:** (none yet)
- **API host:** Railway (auto-deploys from master)
- **Repo:** https://github.com/Kuba-Ventures/Nemat-Trading (public, default branch `master`, protected)
- **Roadmap:** `ROADMAP.md`
- **Factory issue:** https://github.com/Kuba-Ventures/Nemat-Trading/issues/96
- **Client Drive folder:** (unknown)
- **Slack channel:** (none known)
- **Related repos:** (none known)

---

## Changelog  [append-only, never rewrite or delete]

- **2026-10-02:** Caught up from June. Recorded Resend order emails (#93 to #95), checkout phone fix (#97), Vitest in nemat-drop (#98, #99), Meta click id + UTM attribution on orders (#100), ROADMAP.md (#101), and the factory fix (#102): root cause was the floating `claude-code-action@v1` tag, not the OAuth token; now pinned to the v1.0.239 SHA. Flagged #93 to #99 as hand-merged without review, the public lookup routes, and the README vs code conflict on the DB host (code says Supabase). Swapped em dashes for other punctuation throughout, including older entries, per the house rule. Flag moved from shipping to on-track.
- **2026-06-12:** Possible Pulls chase + everyday lineup (`a065659`): `buildPossiblePulls` now composes top-5 chase cards (any rarity) + 3 uncommons + 2 commons, value-ranked within rarity, with accurate per-card odds; the special rate now applies only to rare/mythic chase printings (borderless uncommons keep ~6.2%). New "Also in every pack" divider in `PossiblePullsGrid`; TMNT mock is now a 10-card lineup. Confirmed Railway auto-deploys from master (relock endpoint 401 live = new code present), correcting the "Railway deploys are manual" note. Noted: prod DB's TMNT product still has stale seed odds + empty possiblePulls; one "Re-lock pull odds" run will fix the live site.
- **2026-06-12:** Pull-probabilities phase 2 (`972eb22`): "Possible Pulls" now auto-selects the top-5 most valuable distinct cards per set (`fetchTopCardsByValue` + `buildPossiblePulls`), with images, rarity, and locked odds; special printings detected via `treatmentOf` and labeled with the set's stated special rate. Re-lock now also regenerates the top-5 (auto-managed). Admin uses backend `possiblePulls` directly; TMNT mock updated to the real top-5. Phase 2 complete; both phases now done pending deploy.
- **2026-06-12:** Initial PROJECT.md superdoc. Recorded pull-probabilities phase 1 (per-pack hit rates derived from pack contents + Scryfall, 2:1 rare/mythic split, locked per-card odds, re-lock backfill endpoint + admin button), the Scryfall User-Agent fix, the FE/BE co-deploy requirement, and Mac/Linux dev-env notes.
