# Nemat / Tommy Top Decker Trading
*Sealed trading card pack drops, under market, with honest pull odds.*

*Last updated: 2026-10-14 15:47 ET by kuba-vault*

---

## TL;DR  [rewrite]

Tommy Top Decker Trading sells one sealed-pack drop at a time at tommytopdecker.com: derived pull odds, live USPS quotes, Stripe checkout. It's live. The first Meta campaign (2026-09-28 to 2026-10-06) spent $133.88 for 1 real sale ($43.07, ROAS 0.32x). On 2026-10-13 and 2026-10-14 Finley shipped 19 PRs (#117 to #135): `TOPDECK10` promo codes, click-to-buy Shippo labels, server-side admin login, live Finance and Growth dashboards, and a server-side Meta Purchase event, verified with a live test order. Shawn approved the relaunch on 2026-10-14 and "TTD Relaunch Oct - 14d - Sales" is live. Next: the first real relaunch order should show Purchase from both Browser and Server in Events Manager.

---

## What it is  [rewrite when value prop evolves]

**The problem:** Buyers of MTG booster packs can't see real odds of pulling a given rarity or card; sellers either omit odds or make them up.
**The solution:** A drop storefront that shows pull probabilities derived from pack contents and live Scryfall data, with live shipping quotes and Stripe checkout.
**The user:** Collectors buying sealed trading card packs, one curated drop at a time. Today that's MTG; Pokemon inventory may follow (Shawn, 2026-10-01).
**The value:** Sealed packs under market price, sourced odds and a clean buy-and-ship flow. Brand line: "Sealed packs. Under market."

---

## Status  [rewrite]

- **Phase:** live (post-MVP iteration)
- **Engagement manager:** self-directed
- **Lead:** Finley (build); Shawn (owner); Lauren (books)
- **Cadence:** check-ins with Shawn (last 2026-10-01) plus email; Shawn approved the relaunch on 2026-10-14
- **Next milestone:** first real order from the relaunch campaign shows Purchase from Browser and Server in Events Manager (no date set)
- **Flags:** shipping

---

## Where we are right now  [rewrite]

The ad relaunch is live. Shawn approved it on 2026-10-14, and "TTD Relaunch Oct - 14d - Sales" was Active with $0 spent at 12:20 PM ET that day. Finley is making new ad assets. The first campaign, "TTD Nemat - TMNT Collector - Sales", ran 2026-09-28 to 2026-10-06: $133.88 spent, 4.9% CTR, 1 real sale ($43.07, credited by hand), ROAS 0.32x. Issue #127 is closed. Meta never stopped receiving Purchase events; the Oct 13 orders only looked missing because the Overview date range ended Oct 12. The real gap was the 2026-09-30 Cash App Pay sale: the pixel never loaded on `/success`, so Meta never saw it. #130 now sends Purchase from the Stripe webhook to the Conversions API, deduplicated on the Stripe session id. A live $40.07 test order (refunded) on 2026-10-13 at 10:00 PM ET showed Browser and Server events with the same event id. The admin now has live Finance and Growth pages with a sync pill (#132), and that pill caught a Meta for Developers account lock on 2026-10-14 within minutes. Next concrete step: watch the first real relaunch order in Events Manager. It should show both Browser and Server Purchase, which also confirms the CAPI token survived the account lock.

---

## What's built  [rewrite]

**Frontend / UI** (`artifacts/nemat-drop`, Vite/React on Vercel)
- Storefront product page, live USPS quotes, Stripe checkout and success page (`src/pages/checkout.tsx`, `src/pages/success.tsx`). Phone layout fix for the order card (#97).
- Customer accounts via Supabase auth: email+password with magic-link fallback, order history (`src/pages/account.tsx`, `src/lib/supabase.ts`).
- Admin panel (`src/pages/admin.tsx`): products, orders, waitlist, Stripe order backfill, "Re-lock pull odds". Login posts to `POST /api/admin/login` and keeps a signed 12h token in sessionStorage; every call goes through `adminFetch` (#124). `VITE_ADMIN_PASSWORD` is gone from the bundle.
- Admin layout (#135, option B): a left sidebar splits Insights (Finance, Growth) from Store (Products, Orders, Waitlist), with a "Storefront" link at the bottom. The nav no longer jumps between page widths; on phones it collapses to a grouped top bar.
- Finance and Growth dashboards (`src/pages/adminDashboards.tsx`, #125, option A). Finance: revenue, net, orders, estimated profit, Stripe fees, postage, ad spend, refunds, revenue by day, recent orders with a Label column (Bought / Shipped / Not yet, #133). Growth: ROAS, cost per sale, repeat buyers, revenue vs ad spend, orders by source, campaigns (with Ended and Paused states, #128), GA4 visitor funnel (#128) and account links with brand logo chips, including the Facebook Page (#126, #129).
- Live sync on both dashboards (#132, option A; `src/lib/syncStatus.ts`): a header pill reads "Live, synced <time>" using the oldest source's fetch time, turns amber "Stale" after 2 min and red when a source fails. The Sync button forces a fresh fetch (`?fresh=1`, debounced to 10s); the page auto-syncs every 60s while visible.
- Promo code row on checkout (#119): Apply checks the code with the API; an email field appears below only when a code is entered; the discount line shows above the total.
- Pull odds as per-pack hit-rate bars (`src/components/PullProbabilityChart.tsx`) and an auto-managed Possible Pulls lineup (`src/components/PossiblePullsGrid.tsx`).
- Rolling 10-day drop deadline, one countdown per screen, mobile purchase bar (#76, #77, #86).
- Share card and page metadata (#82); contrast and form-label fixes (#80, #83).
- GTM container `GTM-TVHXMXW5` (#18, confirmed in the live HTML on 2026-10-02) with real Purchase value pushed to `dataLayer` on `/success` (`index.html`, #60).
- Attribution capture (`src/lib/attribution.ts`, #100): saves `fbclid` and `utm_*` on landing (last touch, 28 days) and sends them plus `_fbc`/`_fbp` with checkout.
- Vitest suite (`vitest run`, jsdom) so frontend PRs can clear factory gate 3 (#98, #99). It can't run on macOS locally (see Risks); CI (factory-tests) runs it and passes.

**Backend / data** (`artifacts/api-server`, Express 5 + TS on Railway)
- Routes: `account`, `adminLogin`, `checkout`, `labels`, `metrics`, `orders`, `products`, `scryfall`, `shipping`, `subscribers`, `upload`, `webhooks`, `health`.
- Admin auth (#124, `src/lib/adminAuth.ts`): `POST /api/admin/login` checks a server-only `ADMIN_PASSWORD` (timing-safe, 10 tries per 15 min) and returns an HMAC-signed token (12h). One shared `requireAdmin` accepts only valid tokens; the raw `ADMIN_SECRET` works only with `ADMIN_ACCEPT_LEGACY_KEY=1` (default off). `ADMIN_SECRET` was deliberately not rotated after #124 (owner decision, 2026-10-14; see Risks). `VITE_ADMIN_PASSWORD` is gone from the source and from Vercel (checked with `vercel env ls` on 2026-10-14).
- Server-side Meta Purchase (#130, `src/lib/metaCapi.ts`): for new, paid, live orders the Stripe webhook sends Purchase to the Meta Conversions API. `event_id` is the Stripe session id, the same key as the GTM tag and the CAPI Gateway, so Meta deduplicates. It sends hashed email, phone, name and address, plus fbp/fbc, client IP and user agent (checkout now stores these in Stripe metadata as `capi_ip`/`capi_ua`). Fail-soft: it never throws. Railway has `META_PIXEL_ID` and `META_CAPI_ACCESS_TOKEN`; `META_TEST_EVENT_CODE` was removed after the live test.
- Metrics (#125, `src/lib/metrics.ts`, `GET /api/admin/metrics`): Stripe revenue, fees, discounts and refunds; orders, postage and sources from the orders table; Meta insights via `META_ACCESS_TOKEN`; GA4 funnel via `GA4_SERVICE_ACCOUNT_JSON` (#128, `src/lib/ga4.ts`). Test orders on internal emails and fully refunded orders are excluded. Fees count both `charge` and `payment` balance transactions (`feesByCharge`, #131), so Cash App Pay fees show. Per-source cache is 60s and each source returns its synced time (`src/lib/syncCache.ts`, #132).
- Hand-credited campaign sales (#134): a campaign's Sales = Meta-tracked orders plus orders with `utm_medium=manual` whose `utm_campaign` matches the campaign name or id.
- Promo codes (#118, `src/lib/promo.ts`): `POST /api/checkout/promo` checks `{ code, email }` (20 per 10 min per client); `POST /api/checkout` re-checks and creates the session with `discounts` and a locked `customer_email`. One use per customer, from the email's past completed sessions. `allow_promotion_codes` is off, so Stripe's own code box is gone. `TOPDECK10` (10% off) has been live in Stripe since 2026-10-13.
- CORS allowlist from comma-separated `FRONTEND_URL` (`src/app.ts`). Production lists apex + www as of 2026-10-06.
- Max 2 per item per order, enforced server-side (`src/routes/checkout.ts`). Stripe `success_url`/`cancel_url` use the first `FRONTEND_URL` entry (#110).
- Order emails via Resend from the Stripe webhook (`src/lib/orderEmail.ts`, #93 to #95): a new-order alert to sales and an instant pack-themed confirmation to the buyer. Skipped if `RESEND_API_KEY` is unset.
- Attribution (`src/lib/attribution.ts`, #100): checkout whitelists and caps the keys, stores them in Stripe metadata (`attr_` prefix), and the webhook copies them to 9 new nullable columns on `orders`. The Growth page reads them for orders by source (#125).
- Shipping quotes and labels (`src/routes/shipping.ts`, `src/lib/shippo.ts`): quotes and labels share `parcelFor()`: 2 oz for the first pack plus 0.7 oz per extra, in a 6 x 4 x 1 in parcel (#121). Checkout stores the Shippo service token in session metadata.
- Click-to-buy labels (#121, #122, #123, `src/routes/labels.ts`, `src/lib/labelLink.ts`): each paid order emails sales@ the packing slip and a "Buy label & print" button. The signed link (HMAC with `LABEL_LINK_SECRET`) shows the order on GET and buys only on POST, claims the row first so a double click can't buy twice, then emails the customer tracking and offers a label + slip PDF (`pdf-lib`). Seller phone and email come from `SHIP_FROM_*` env vars on Railway (#122).
- "Shipped" state for orders sent without a Shippo label (#133): `orders.shippo_transaction_id = 'shipped-elsewhere'` blocks any label purchase, the sales@ link shows "Already shipped" (packing slip only), and the dashboard Label column reads Shipped. No schema change. Order #P0RDZARQ (2026-09-30) is marked this way; postage shows $0.00 because the client shipped it and the cost is unknown.
- Pull-odds model and Possible Pulls selector in `src/routes/scryfall.ts`; `POST /api/admin/products/relock-pulls` backfill in `src/routes/products.ts`.
- Lookup routes secured (#104, `src/routes/scryfall.ts`): `/tcgplayer/debug` removed. `POST /lookup/tcgplayer` (admin form, one Anthropic call per lookup), `GET /scryfall/:id/price` and `GET /tcgplayer/price-check` use the existing `requireAdmin` check (`x-admin-key` against `ADMIN_SECRET`) plus input validation.
- Public `POST /tcgplayer/price` for the storefront (#104): accepts only `tcgplayer.com/product/<id>` URLs, builds the upstream URL from the id, and returns only `{ lowestPrice }`. Limited to 30 calls per 10 min per client by an in-memory fixed-window limiter (`src/lib/rate-limit.ts`) keyed on the rightmost X-Forwarded-For entry.
- One shared TCGPlayer price figure, no seed fallback (`src/lib/tcg-pricing.ts`, #65, #66).
- Google Sheets sync via Apps Script (`src/lib/sheets.ts`, `apps-script/`).
- Schema changes as idempotent `ALTER TABLE` in the bootstrap (`src/index.ts`), which also enables RLS on all tables to block Supabase's public Data API.
- Tests: `tsx --test` (attribution, drop window, order email, TCG pricing, lookup route auth and validation, rate limiter, promo, Shippo, packing slip, label link, admin auth, metrics, GA4, Meta CAPI, sync cache).

**Brand and print**
- Brand guide, 11 pages: cover, foundation, primary logo, secondary marks, misuse, color, typography, iconography, applications, thank-you insert, voice and tone. Source and PDF exports in `docs/brand-guide` (#115, merged 2026-10-07).
- Palette from the TT card mark: charcoal #2B2B30 (default ground), cream #F5F0E6, gold #C9A961, pip red #B03A3A. Type: Gotham Black (name and headlines, caps only), JetBrains Mono (prices and numbers), Inter (body).
- Positioning: "Sealed packs. Under market." Principles: Under market, One drop at a time, Packed like it matters. Copy says "sealed trading card packs", not a specific game.
- Thank-you insert: Shawn picked format 1 (trading card, 2.5 x 3.5 in) with `TOPDECK10`, 10% off, one use per customer (#117). Print-ready PDF (2.75 x 3.75 in with bleed) and a proof with crop marks are in `docs/brand-guide` exports (#120). The QR goes to `https://tommytopdecker.com/?utm_source=insert&utm_medium=print&utm_campaign=thankyou`, so repeat orders land in the #100 attribution.

**Discounts** (#114, then #118 and #119)
- #114 added promotion codes and a Discount line in both order emails (the webhook passes `total_details.amount_discount`). #118 replaced Stripe's code box with our own check, so codes are one use per customer. The orders table and Sheet still store the pre-discount line subtotal (no schema change); the Finance page reads discounts from Stripe.

**Infrastructure**
- Vercel serves the frontend from the apex domain; `www` 308-redirects to apex (checked 2026-10-06). Railway project "Tommy Top Decker Trading Co", api-server service at https://workspaceapi-server-production-c93f.up.railway.app.
- pnpm monorepo (pnpm 10.33.0). Shared libs: `lib/db` (Drizzle + pg), `lib/api-zod`, `lib/api-client-react`, `lib/api-spec` (OpenAPI + Orval).
- Supervised PR factory (`.github/workflows/factory.yml`, `.claude/agents/pr-reviewer.md`): low-risk paths can auto-merge, everything else escalates. Review action pinned to v1.0.239 SHA as of #102; first verdict on the pin landed on #104.
- Google Ads MCP setup docs and scripts, local and Cloud Run (`docs/google-ads-mcp.md`, `scripts/setup-google-ads-mcp.sh`, `scripts/deploy-google-ads-mcp-cloudrun.sh`).
- `ROADMAP.md` (#101, #105, #107) tracks staged work with a dated item on every line and a Timeline; cross-reference it for anything not covered here.
- `CLAUDE.md` holds the merge policy, the owner's initiative and previews preferences (#108) and the shared standard block (no em dashes, `claude/<description>` branches).

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
| Tracking | Google Tag Manager (browser pixel + CAPI Gateway), Meta Conversions API (server) | `artifacts/nemat-drop/index.html`, `src/lib/metaCapi.ts` |
| Analytics | Meta Marketing API insights, GA4 Data API | `src/lib/metrics.ts`, `src/lib/ga4.ts` |
| PDF | pdf-lib 1.17.1 (label + packing slip) | `src/lib/packingSlip.ts` |
| AI/LLM | Anthropic Claude API (card intel); claude-code-action (PR review) | `src/routes/scryfall.ts`, `.github/workflows/factory.yml` |
| Tests | `tsx --test` (API), Vitest 4 + jsdom 26 (frontend) | |

---

## Integrations & MCPs  [rewrite, auto-generated from MCP config files]

| Integration | Purpose | Cost | Status |
|---|---|---|---|
| Stripe | Checkout + webhooks, promo codes, Finance metrics | usage-based | live |
| Shippo | USPS rates; click-to-buy labels from the sales@ email (#123) | usage-based | live (rates and labels; a real label bought and tested through the sales@ link, owner confirmed 2026-10-14) |
| Meta Conversions API | Server-side Purchase from the Stripe webhook (#130) | free | live, verified 2026-10-13 |
| Meta Marketing API | Spend, campaigns, CTR for the Growth page | free | live |
| Meta Ads | Paid traffic; first campaign $133.88 (2026-09-28 to 2026-10-06) | usage-based | live (relaunch campaign since 2026-10-14) |
| GA4 Data API | Visitor funnel on Growth (#128) | free | live (`GA4_SERVICE_ACCOUNT_JSON` set, owner confirmed 2026-10-14) |
| Resend | Order alert + customer confirmation emails | unknown | live |
| Supabase | Postgres + customer auth | unknown | live |
| Google Apps Script | Append orders and signups to a Sheet | free | live |
| Google Tag Manager | Purchase value to `dataLayer` | free | live |
| Anthropic Claude | Card intel; factory PR review | usage-based | live |
| remove.bg | Background removal for product images | usage-based | live |
| Cloudinary | Browser-direct admin image upload | unknown | live (optional) |
| Scryfall | Per-rarity card counts + pricing for pull odds | free | live |
| Google Ads MCP | Ads access for Claude clients (docs + scripts only) | unknown | documented |

*Source: no MCP configs found in repo. Table built from `.env.example` keys, route and lib code, `index.html`, `factory.yml`, `docs/google-ads-mcp.md` and merged PRs #117 to #135.*

---

## Decisions log  [append-only, never rewrite or delete]

- **2026-10-14, Keep the current `ADMIN_SECRET` (no rotation after #124)**. Owner's decision. The old frontend sent `VITE_ADMIN_PASSWORD` as `x-admin-key` and the API compared it to `ADMIN_SECRET`, so the value that shipped in the public bundle is `ADMIN_SECRET` itself. Accepted as a known risk instead of rotating and signing everyone out.
- **2026-10-14, Admin sidebar splits Insights from Store (option B, #135)**. Finance and Growth sit apart from Products, Orders and Waitlist, so reporting and store management don't share one tab row.
- **2026-10-14, Hand-credit convention for campaign sales (#134)**. To credit an order to a campaign by hand, set `utm_source=meta`, `utm_medium=manual` and `utm_campaign=<exact campaign name or id>`. Growth counts these with Meta-tracked orders. Used for the 2026-09-30 sale, which Meta never saw.
- **2026-10-14, "Shipped elsewhere" uses an existing column (#133)**. `shippo_transaction_id = 'shipped-elsewhere'` marks orders shipped without a Shippo label, instead of adding a status column. Avoids a migration and blocks label purchase with the same check.
- **2026-10-14, Live dashboards with a sync pill (option A, #132)**. Cut the API cache from 5 min to 60s and show each page's oldest fetch time, so a stale or failed source is visible. It caught the Meta developer account lock the same day.
- **2026-10-14, Relaunch Meta ads**. Shawn approved the relaunch after the first campaign (1 real sale, ROAS 0.32x) and the server-side Purchase fix.
- **2026-10-13, Three Meta Purchase paths share one dedup key (#130)**. Keep the GTM browser pixel and the CAPI Gateway, and add a direct server CAPI call from the Stripe webhook. All three use the Stripe session id as `event_id`, so Meta counts one purchase. This resolves the double-counting concern behind the 2026-08-12 revert (#59). The Gateway alone missed the 2026-09-30 Cash App Pay sale because it only mirrors pixel events.
- **2026-10-13, Labels are click-to-buy, not automatic (#123)**. Reverses the same day's option B (fully automatic, #121) at Shawn's request: sales@ gets a "Buy label & print" link, and nothing is bought until someone clicks Buy on the page. A GET never buys, because mail scanners prefetch links.
- **2026-10-13, Admin password checked on the server (#124)**. `VITE_ADMIN_PASSWORD` was readable in the public bundle and unlocked every admin endpoint. Replaced with a server-side login that returns a signed 12h token.
- **2026-10-13, Promo codes are one use per customer, checked by our API (#118, #119)**. Stripe can't enforce this for guest checkout, so the API checks the email's past sessions before payment and locks the email on Stripe's page. Accepted gaps: a different email gets around it, and two simultaneous checkouts with one email both pass.
- **2026-10-13, Finance and Growth dashboards in the admin (option A, #125)**. A scorecard layout split into two pages, fed by one metrics endpoint, with per-card errors so one failed source never blanks the page.
- **2026-10-07, Thank-you insert is format 1 with TOPDECK10 (#117)**. Shawn picked the trading card format, code `TOPDECK10`, 10% off, one use per customer. Recorded 2026-10-13.
- **2026-10-07, Auto-buy labels through Shippo (Option C, #113)**. Buy the USPS label per order through the Shippo API and attach it plus a branded packing slip to the sales@ email, then email the customer tracking. Rejected a Pirate Ship spreadsheet flow (no Stripe integration and no public API we could find) and the Shippo web app (still manual). Not built: needs the owner's OK for automatic postage spend.
- **2026-10-07, Discounts via Stripe promotion codes, no schema change (#114)**. Checkout accepts Stripe promotion codes and the emails show the discount. The orders table and Sheet keep the pre-discount line subtotal for now, to avoid a migration.
- **2026-10-07, Print inserts carry a UTM-tagged QR**. The insert QR uses `utm_source=insert&utm_medium=print&utm_campaign=thankyou`, so repeat orders show up in the existing #100 attribution with no new tracking code.
- **2026-10-07, Brand guide keeps the TT card mark palette and leads on price**. Built the identity on the existing card mark's warm colors with charcoal as the default ground, and led positioning on under-market pricing ("Sealed packs. Under market.").
- **2026-10-01, Brand stays Tommy Top Decker, game-neutral**. Shawn said at the check-in that the brand is Tommy Top Decker TCG, not a specific game; Pokemon inventory may follow in a month or two. Public copy says "sealed trading card packs". Nemat stays an internal name only.
- **2026-10-06, First FRONTEND_URL entry is the Stripe redirect base**. One variable now serves both CORS and Stripe; #110 splits it and uses the first entry, so the primary domain goes first. Chose this over adding a second variable to keep Railway config to one value.
- **2026-10-06, FRONTEND_URL on Railway must list apex and www**. The site serves from apex and www redirects there, so the API's CORS allowlist needs both. If the Vercel primary domain ever changes, update `FRONTEND_URL` the same day. Symptom of a miss: a CORS error in the console and the fallback product with no image. Fixed by config, since `app.ts` already splits a comma-separated list.
- **2026-10-02, Rate limit the public price route in process, keyed on the rightmost X-Forwarded-For**. `trust proxy: true` makes `req.ip` the leftmost, client-controlled entry, so keying on it lets anyone dodge the limit. Chose a small in-memory limiter over adding `express-rate-limit` or Redis; it fits the single Railway service but resets on deploy and would multiply with replicas.
- **2026-10-02, Gate lookup routes with the existing admin key, keep one public price route**. Reused `requireAdmin` rather than a new auth scheme. `POST /tcgplayer/price` stays public because the logged-out storefront calls it; it gets URL validation, a server-built upstream URL and a price-only response instead of auth. Removed `/tcgplayer/debug` outright since nothing called it.
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

- [ ] On the first real relaunch order, confirm Events Manager shows Purchase from both Browser and Server with one event id. This also answers whether the 2026-10-14 Meta developer account lock touched the CAPI token. Owner: Finley
- [ ] Finish the new ad assets for "TTD Relaunch Oct - 14d - Sales". In progress since 2026-10-14. Owner: Finley
- [ ] Review relaunch results on the Growth page (sales, cost per sale, ROAS) against the first campaign's $133.88 spend and 0.32x ROAS. Owner: Finley
- [ ] Confirm `ADMIN_ACCEPT_LEGACY_KEY` is unset on Railway (the last #124 env step; not confirmed). Owner: Finley
- [ ] Send the thank-you cards to print from the print-ready PDF (#120). Not sent as of 2026-10-14. Owner: Finley
- [ ] Answer Shawn's 2026-10-03 email about opening a Mercury account and its minimum balance. Owner: Finley
- [ ] Send bank statements and card info to Lauren for the 2025 books. Owner: Shawn
- [ ] Send vendor receipts for the 72 units. Owner: Shawn
- [ ] Write the reimbursement check (about $1,500 to $1,700 at original cost). Owner: Shawn
- [ ] Confirm whether a 2025 filing is required, given the mid-December formation date. Owner: Lauren
- [ ] Confirm Railway appends to X-Forwarded-For rather than overwriting it (single proxy hop). The rate limiter keys on the rightmost entry and assumes Railway adds it. Owner: Finley
- [ ] Decide whether to retro-review #93 to #99, which were hand-merged on 2026-09-28 without a factory verdict. Owner: Finley
- [ ] Fix `README.md`: it still says Postgres runs on Railway, but the code targets Supabase. It also omits the Resend and Supabase env vars. #104 fixed the route table and this run fixed the `FRONTEND_URL` row. Owner: Finley
- [ ] Run "Re-lock pull odds" on production for TMNT. Checked 2026-10-06: the live TMNT product still has empty `possiblePulls` and tier rows with no percentages. Owner: Finley
- [ ] Pick the next drop after TMNT and a drop cadence. Waiting on: Finley

---

## Risks & known issues  [rewrite]

- **Meta tracking depends on one developer account.** On 2026-10-14 at about 11:45 AM ET the Graph API returned "API access blocked": Meta locked the Meta for Developers account for "unusual activity". Account confirmation restored access at about 11:48 AM ET. Unknown whether the server-side CAPI token was affected; the first real relaunch order will show it.
- **One real sale so far.** The first campaign spent $133.88 for 1 real sale (ROAS 0.32x). The relaunch has no results yet.
- **Hand-credited sales are manual.** Growth counts `utm_medium=manual` orders toward a campaign only if `utm_campaign` matches its exact name or id. A typo silently drops the credit.
- **Postage unknown on shipped-elsewhere orders.** Orders marked `shipped-elsewhere` show $0.00 postage, so Finance understates shipping cost for them (#P0RDZARQ today).
- **Promo check gaps.** One use per customer is keyed on email: a different email gets around it, and two simultaneous checkouts with one email both pass (#118).
- **Discounts not stored on orders.** The orders table and Sheet keep the pre-discount subtotal. The Finance page reads discounts from Stripe, but the Sheet and raw SQL overstate discounted orders until a discount column is added.
- **Unreviewed merges.** #93 to #99 (order emails, checkout fix, Vitest) went to master by hand with no factory verdict. They touch the webhook and checkout.
- **`reviewer_completed` can be wrong.** On #104 the reviewer reported `reviewer_completed: true` though it only matched paths and did not read the full diff. That backstop cannot be trusted to prove a full review happened; an APPROVE-LOWRISK could rest on a file-list check alone.
- **Rate limiter limits.** The `POST /tcgplayer/price` limiter lives in process memory: it resets on every deploy and would multiply with replicas. It keys on the rightmost X-Forwarded-For entry, which is only safe if Railway appends its own entry (unconfirmed).
- **DB host docs conflict.** `README.md` says Railway Postgres. `CLAUDE.md`, the RLS lockdown in `src/index.ts` (written for Supabase's Data API) and PR #1 point to Supabase. Code evidence favors Supabase; the live `DATABASE_URL` wasn't checked.
- **No migration system.** Schema changes must be idempotent `ALTER TABLE` in the API bootstrap or prod drifts and 500s (this previously caused orders to silently not persist).
- **Leaked admin secret kept on purpose (accepted risk).** The value that shipped in the old public bundle as `VITE_ADMIN_PASSWORD` is `ADMIN_SECRET`, and the owner chose not to rotate it (2026-10-14). Since #124, `ADMIN_SECRET` is also the HMAC key for admin tokens (`src/lib/adminAuth.ts`), so anyone holding the old value could sign a valid 12h admin token, which covers order details, the waitlist and product and price edits. Rotating it would close this and sign everyone out. The variable itself is gone from the source and from Vercel.
- **Ephemeral uploads.** Server-side uploads land on Railway's local disk and vanish on redeploy; Cloudinary is optional.
- **Special-printing odds are approximate.** One stated special rate covers all rare/mythic special treatments.
- **FRONTEND_URL is tied to the Vercel domains.** It feeds the CORS allowlist (all entries) and the Stripe redirect base (first entry). Changing the primary domain on Vercel without updating Railway breaks every API call from the site; this caused the 2026-10-06 outage. Apex is primary, not www.
- **Mac dev friction.** `pnpm-workspace.yaml` overrides strip darwin native binaries (rollup, esbuild), so frontend Vitest and the Vite dev server can't run on macOS locally. Frontend tests run in CI (factory-tests), which passes; UI changes get checked on Vercel previews. The API won't boot locally without a real `DATABASE_URL`.
- **`.env.example` secret hygiene.** Real production secrets have been pasted into `.env.example` before, and the repo is public. Check it whenever env vars change.

---

## Links  [rewrite]

- **Live URL:** https://tommytopdecker.com (Vercel, apex is primary; `www` 308-redirects to apex, checked 2026-10-06)
- **Staging:** (none yet)
- **API host:** https://workspaceapi-server-production-c93f.up.railway.app (Railway project "Tommy Top Decker Trading Co", auto-deploys from master)
- **Repo:** https://github.com/Kuba-Ventures/Nemat-Trading (public, default branch `master`, protected)
- **Roadmap:** `ROADMAP.md`
- **Brand guide:** `docs/brand-guide` (#115)
- **Admin:** https://tommytopdecker.com/admin (Insights: Finance, Growth; Store: Products, Orders, Waitlist)
- **Meta dataset:** TTD Trading, pixel 891018810380986 (Events Manager)
- **Meta Purchase issue (closed):** https://github.com/Kuba-Ventures/Nemat-Trading/issues/127
- **Shippo labels issue (closed):** https://github.com/Kuba-Ventures/Nemat-Trading/issues/113
- **Print-ready thank-you card:** `docs/brand-guide/exports/Tommy Top Decker Thank-you Card (print).pdf` (#120)
- **Factory issue (closed):** https://github.com/Kuba-Ventures/Nemat-Trading/issues/96
- **Client Drive folder:** (unknown)
- **Slack channel:** (none known)
- **Related repos:** (none known)

---

## Changelog  [append-only, never rewrite or delete]

- **2026-10-14:** Recorded the owner's confirmations: Shippo has a payment method and a real label was bought and tested through the sales@ link; `GA4_SERVICE_ACCOUNT_JSON` is set; a `TOPDECK10` test order went through; thank-you cards not sent to print yet (Finley owns it); Finley owns the relaunch ad assets; `ADMIN_SECRET` deliberately not rotated (logged as a decision and an accepted risk). Checked `vercel env ls`: `VITE_ADMIN_PASSWORD` is no longer set on Vercel.
- **2026-10-14:** Recorded the 2026-10-13 and 2026-10-14 session (#117 to #135, all merged and deployed). Closed #127: no outage, the real gap was the 2026-09-30 Cash App Pay sale; #130 adds server-side Meta CAPI Purchase, verified with a live $40.07 test order (refunded). Added #131 (Cash App Pay fees), #132 (live dashboards and sync pill), #133 (shipped-elsewhere state), #134 (hand-credited campaign sales), #135 (admin sidebar), plus #117 to #129 (TOPDECK10 one use per customer, print-ready card, click-to-buy labels, server-side admin login, Finance and Growth dashboards, GA4 funnel). Recorded first campaign results, Shawn's relaunch approval, the live relaunch campaign and the Meta developer account lock (about 3 minutes). Flag moved from on-track to shipping.
- **2026-10-07:** Recorded the brand guide (#115, merged: 11 pages, TT card mark palette, game-neutral "Sealed packs. Under market." positioning; Nemat stays internal), three thank-you insert formats with a placeholder 10% code and a UTM-tagged QR (options emailed to Shawn), #114 (Stripe promotion codes, discount line in both emails, 57/57 tests; merged at the owner's request, coupon not yet created; live checkout not checked this run) and #113 (Shippo auto-labels, Option C, blocked on owner inputs). Added the 2026-10-01 check-in loops for Shawn and Lauren, the unanswered Mercury question and a possible shipping under-quote (0.7 oz per unit). Tagline and value prop now game-neutral.
- **2026-10-06:** Recorded the CORS outage and fix: `FRONTEND_URL` on Railway held only www while the site serves from apex, so the storefront showed a stale $32.00 fallback with no photo. Set it to apex + www and redeployed (config only). The comma-separated value then broke Stripe redirect URLs until #110 took the first entry; checkout was likely failing for about 30 minutes (unconfirmed). Updated the `FRONTEND_URL` docs in `README.md` and `.env.example`. Corrected Links: apex is primary, not www. Live check: TMNT still has empty `possiblePulls`. Verified #110 on prod the same day with an end-to-end test checkout: ZIP 10001 loaded shipping rates (Ground Advantage $6.07, Priority $13.48, Express $49.98), Stripe Checkout showed TMNT $34.00 + $6.07 = $40.07, and Stripe's back arrow (`cancel_url`) returned to the single valid URL https://tommytopdecker.com/checkout?qty=1. Nothing was paid and no order was created.
- **2026-10-02:** Recorded #107 (ROADMAP.md marks #96 and #104 done, closing that open loop) and #108 (initiative and previews preferences in `CLAUDE.md`). Backfilled ROADMAP.md: a sourced date on all 23 items, a date range on every stage and a Timeline from the first commit (2026-03-13). Live check: storefront returns 200 and serves `GTM-TVHXMXW5`; API route checks were not run this time.
- **2026-10-02:** Recorded #104 (lookup routes behind `requireAdmin`, `/tcgplayer/debug` removed, public price route rate limited and price-only) and #105 (ROADMAP root cause corrected). Closed out the #96 open loop: #104 got a real ESCALATE verdict on the pinned SHA. Added risks for `reviewer_completed` reporting true without a full diff read and for the per-process limiter. New open loop: confirm Railway's X-Forwarded-For behavior.
- **2026-10-02:** Caught up from June. Recorded Resend order emails (#93 to #95), checkout phone fix (#97), Vitest in nemat-drop (#98, #99), Meta click id + UTM attribution on orders (#100), ROADMAP.md (#101), and the factory fix (#102): root cause was the floating `claude-code-action@v1` tag, not the OAuth token; now pinned to the v1.0.239 SHA. Flagged #93 to #99 as hand-merged without review, the public lookup routes, and the README vs code conflict on the DB host (code says Supabase). Swapped em dashes for other punctuation throughout, including older entries, per the house rule. Flag moved from shipping to on-track.
- **2026-06-12:** Possible Pulls chase + everyday lineup (`a065659`): `buildPossiblePulls` now composes top-5 chase cards (any rarity) + 3 uncommons + 2 commons, value-ranked within rarity, with accurate per-card odds; the special rate now applies only to rare/mythic chase printings (borderless uncommons keep ~6.2%). New "Also in every pack" divider in `PossiblePullsGrid`; TMNT mock is now a 10-card lineup. Confirmed Railway auto-deploys from master (relock endpoint 401 live = new code present), correcting the "Railway deploys are manual" note. Noted: prod DB's TMNT product still has stale seed odds + empty possiblePulls; one "Re-lock pull odds" run will fix the live site.
- **2026-06-12:** Pull-probabilities phase 2 (`972eb22`): "Possible Pulls" now auto-selects the top-5 most valuable distinct cards per set (`fetchTopCardsByValue` + `buildPossiblePulls`), with images, rarity, and locked odds; special printings detected via `treatmentOf` and labeled with the set's stated special rate. Re-lock now also regenerates the top-5 (auto-managed). Admin uses backend `possiblePulls` directly; TMNT mock updated to the real top-5. Phase 2 complete; both phases now done pending deploy.
- **2026-06-12:** Initial PROJECT.md superdoc. Recorded pull-probabilities phase 1 (per-pack hit rates derived from pack contents + Scryfall, 2:1 rare/mythic split, locked per-card odds, re-lock backfill endpoint + admin button), the Scryfall User-Agent fix, the FE/BE co-deploy requirement, and Mac/Linux dev-env notes.
