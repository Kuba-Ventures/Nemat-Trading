# Tommy Top Decker Trading Roadmap: turn paid ad traffic into attributable, repeatable drops

*Owner: Finley · Started: 2026-10-02 · Status: live and taking orders; Meta ads relaunched 2026-10-14 ("TTD Relaunch Oct - 14d - Sales") after the first campaign returned 1 real sale on $133.88 (ROAS 0.32x); server-side Meta Purchase live and verified (#130, closes #127); `TOPDECK10` live, one use per customer (#118, #119); click-to-buy Shippo labels shipped (#121 to #123, closes #113); admin login moved to the server (#124; `ADMIN_SECRET` kept on purpose); live Finance and Growth dashboards with a sync pill and sidebar (#125 to #135); every item dated · last verified against the code, PRs and issues 2026-10-14*

## What this is

Tommy Top Decker Trading (repo: Nemat-Trading) is a sealed trading card pack drop storefront at tommytopdecker.com for collectors buying one featured product at a time. Inventory is MTG today; the brand stays game-neutral (Tommy Top Decker TCG) and Pokemon may follow. Buyers see derived pull odds, get live USPS shipping quotes, and pay with Stripe Checkout. The frontend is Vite + React on Vercel (`artifacts/nemat-drop`), the API is Express 5 on Railway (`artifacts/api-server`), and data lives in Postgres via Drizzle (`lib/db`), with orders and signups mirrored to a Google Sheet.

### Status legend

- [ ] not started · [~] in progress · [x] done
- Tags: **(design)** **(build)** **(growth)** **(compliance)**
- ⚠️ = critical path
- Dates: done items show the PR merge date (or the commit date where there was no PR); open items show the date they entered the plan.

## Timeline

- **2026-03-13** · First commit to the repo.
- **2026-03-16** · Built a dark-mode flash-drop landing page for the TMNT booster pack.
- **2026-04-08** · Added Stripe checkout, the admin panel and a products database, with Railway (API) and Vercel (frontend) deploy config.
- **2026-05-19** · Removed the site password gate so visitors land on the storefront; added live USPS quotes via Shippo.
- **2026-05-20** · Stripe webhook started writing orders to Postgres and the Google Sheet.
- **2026-06-10** · Started working through PRs: the supervised PR factory (#2) and RLS on all public tables (#1).
- **2026-06-11** · Customer accounts with order history via Supabase auth (#9).
- **2026-06-12** · Fixed orders silently not saving (missing `tax_cents` column, #11). Decided pull odds are derived from pack contents plus live Scryfall data, not hand-typed.
- **2026-07-13** · New TommyTopDecker brand logo across the site (#27, #28).
- **2026-08-07** · Capped purchases at 2 per item per order (#47).
- **2026-08-10** · Opened the Meta Ads setup tracker (issue #57).
- **2026-08-12** · Reverted the direct Meta Pixel + CAPI code and sent Purchase value through GTM instead (#59, #60).
- **2026-08-26** · Google Ads MCP setup, local and Cloud Run (#61 to #64).
- **2026-09-03** · Rolling 10-day drop deadline, share card and metadata, accessibility fixes (#77, #82, #80, #83).
- **2026-09-28** · Meta ad campaign started. Order emails via Resend went live (#93 to #95). The factory review broke the same day when the floating `claude-code-action@v1` tag moved (#96).
- **2026-09-30** · First real customer sale, paid with Cash App Pay. The Meta pixel never loaded on `/success`, so Meta never saw it.
- **2026-10-01** · Meta click id and UTM tags recorded on every order (#100).
- **2026-10-02** · ROADMAP.md added (#101). Factory review pinned to a SHA (#102); its first real verdict on #104 closed #96. Admin lookup routes locked down and the public price route rate limited (#104).
- **2026-10-01** · Check-in with Shawn: the brand stays Tommy Top Decker TCG, not one game. Action items: thank-you cards with a 10% coupon, and order management and packing slips.
- **2026-10-06** · CORS outage: the API allowed only www while the site serves from apex, so the storefront showed a stale fallback product. Fixed by setting Railway `FRONTEND_URL` to apex + www; checkout then took only the first entry as its Stripe redirect base (#110). The first Meta campaign ended the same day: $133.88 spent, 4.9% CTR, 1 real sale ($43.07), ROAS 0.32x.
- **2026-10-07** · Brand guide merged (#115) and three thank-you insert options emailed to Shawn. Stripe promotion codes enabled at checkout (#114). Opened #113 (Shippo auto-labels, chosen over Pirate Ship). Shawn picked insert format 1 with `TOPDECK10`, 10% off, one use per customer (recorded in #117).
- **2026-10-13** · `TOPDECK10` live in Stripe with a one-use-per-customer check and a promo field at checkout (#118, #119). Print-ready thank-you card (#120). USPS labels: fully automatic (#121), then switched to click-to-buy from the sales@ email (#122, #123); #113 closed. Admin login moved to the server (#124). Finance and Growth dashboards (#125, #126, #128, #129). Live test order verified Browser and Server Purchase in Meta with one event id.
- **2026-10-14** · Server-side Meta Purchase merged (#130); #127 closed (no outage, the gap was the Cash App Pay sale). Cash App Pay fees counted (#131). Live dashboards with a sync pill (#132). Meta developer account lock at about 11:45 AM ET, cleared about 3 minutes later. Shipped-elsewhere order state (#133), hand-credited campaign sales (#134), admin sidebar (#135). Shawn approved the relaunch; "TTD Relaunch Oct - 14d - Sales" went live.

## Stage 0: Storefront and checkout (done, 2026-05-19 to 2026-10-06)

- [x] **2026-05-19** · **(build)** Product page, Shippo USPS quotes, Stripe Checkout with server-side rate re-validation (`src/routes/shipping.ts`, `src/routes/checkout.ts`).
- [x] **2026-05-20** · **(build)** Stripe webhook writes orders to Postgres and the Orders sheet (`src/routes/webhooks.ts`, `src/lib/sheets.ts`).
- [x] **2026-08-07** · **(build)** Max 2 per item per order, enforced server-side (`MAX_QUANTITY_PER_ORDER` in `src/routes/checkout.ts`; Kuba-Ventures/Nemat-Trading#47).
- [x] **2026-06-11** · **(build)** Customer accounts with order history via Supabase auth (`src/pages/account.tsx`, `src/lib/supabaseAuth.ts`; Kuba-Ventures/Nemat-Trading#9).
- [x] **2026-06-12** · **(build)** Admin panel for products, orders, and waitlist, gated server-side by `x-admin-key` (`src/pages/admin.tsx`, `src/routes/products.ts`; Kuba-Ventures/Nemat-Trading#12).
- [x] **2026-10-06** · **(build)** Storefront CORS allows apex and www (Railway `FRONTEND_URL`, config only), and Stripe return URLs use the first `FRONTEND_URL` entry (`src/routes/checkout.ts`; Kuba-Ventures/Nemat-Trading#110). Verified 2026-10-06 by a prod test checkout: Stripe's `cancel_url` returned to https://tommytopdecker.com/checkout?qty=1; nothing was paid.

## Stage 1: Pull odds and drop mechanics (done, 2026-06-12 to 2026-09-28)

- [x] **2026-06-12** · **(build)** Pull probabilities derived from pack contents plus live Scryfall data, with a "Re-lock pull odds" backfill (`src/routes/scryfall.ts`, `POST /api/admin/products/relock-pulls`).
- [x] **2026-09-03** · **(build)** One shared TCGPlayer price figure, no seed fallback (Kuba-Ventures/Nemat-Trading#65, Kuba-Ventures/Nemat-Trading#66).
- [x] **2026-09-04** · **(build)** Rolling 10-day drop deadline that rolls forward instead of expiring (`src/lib/drop-window.ts`; Kuba-Ventures/Nemat-Trading#77, Kuba-Ventures/Nemat-Trading#86).
- [x] **2026-09-28** · **(design)** One countdown per screen, mobile purchase bar, phone layout fixes (Kuba-Ventures/Nemat-Trading#76, #88, #97).
- [x] **2026-09-03** · **(compliance)** Accessibility fixes for contrast and form labels (Kuba-Ventures/Nemat-Trading#80, Kuba-Ventures/Nemat-Trading#83).
- [x] **2026-09-03** · **(growth)** Share card and real page metadata (Kuba-Ventures/Nemat-Trading#82).

## Stage 2: Order emails and ad attribution (in progress, 2026-08-12 to present)

- [x] **2026-09-28** · **(build)** Resend sales alert and pack-themed customer confirmation email on every order (`src/lib/orderEmail.ts`; Kuba-Ventures/Nemat-Trading#93, #94, #95).
- [x] **2026-08-12** · **(growth)** GTM container with real Purchase value pushed to `dataLayer` on `/success` (`index.html`, Kuba-Ventures/Nemat-Trading#60). The direct Meta Pixel + CAPI code was added and then reverted (Kuba-Ventures/Nemat-Trading#58, #59).
- [x] **2026-10-01** · **(growth)** Capture `fbclid`, `_fbc`/`_fbp`, and `utm_*` on landing and store them on each order (`src/lib/attribution.ts` in both apps; Kuba-Ventures/Nemat-Trading#100).
- [x] **2026-10-13** · **(growth)** Surface attribution in the admin. The Growth page shows orders by source (UTM, fbclid, thank-you code) from the #100 columns (Kuba-Ventures/Nemat-Trading#125). Hand-credited sales count toward their campaign since 2026-10-14 (Kuba-Ventures/Nemat-Trading#134).
- [x] **2026-10-07** · **(design)** Brand guide: 11-page visual identity on the TT card mark palette, game-neutral copy, "Sealed packs. Under market." positioning (`docs/brand-guide`; Kuba-Ventures/Nemat-Trading#115).
- [~] **started 2026-10-07** · **(growth)** Thank-you insert with a 10% return code and a UTM-tagged QR (`utm_source=insert`), from the 2026-10-01 check-in. Three formats emailed to Shawn 2026-10-07; he picked format 1, `TOPDECK10`, 10% off, one use per customer (Kuba-Ventures/Nemat-Trading#117). Print-ready PDF merged 2026-10-13 (Kuba-Ventures/Nemat-Trading#120). Not sent to print as of 2026-10-14 (owner: Finley).
- [x] **2026-10-07** · **(build)** Accept Stripe promotion codes at checkout and show the discount in both order emails (`src/routes/checkout.ts`; Kuba-Ventures/Nemat-Trading#114).
- [x] **2026-10-13** · **(growth)** Create the coupon and promotion code in Stripe once Shawn confirms the code name, % and limits, then place a test order. `TOPDECK10` (10% off) live in Stripe since 2026-10-13; one use per customer checked by the API before payment, with a promo field on checkout (Kuba-Ventures/Nemat-Trading#118, Kuba-Ventures/Nemat-Trading#119). A `TOPDECK10` test order went through (owner confirmed 2026-10-14).
- [x] **2026-10-13** · **(build)** Auto-buy USPS labels via Shippo and attach the label plus a branded packing slip to the sales@ order email; email customers tracking (Kuba-Ventures/Nemat-Trading#113). Shipped fully automatic (Kuba-Ventures/Nemat-Trading#121), fixed USPS seller phone and email (Kuba-Ventures/Nemat-Trading#122), then switched to click-to-buy from the sales@ email at Shawn's request (Kuba-Ventures/Nemat-Trading#123). #113 closed 2026-10-13. Shippo has a payment method, and a real label was bought and tested through the sales@ link (owner confirmed 2026-10-14).
- [x] **2026-10-13** · **(build)** Check the shipping quote weight: 0.7 oz per unit in a 6 x 4 x 1 in parcel (`PRODUCT_WEIGHT_OZ`, `src/routes/shipping.ts`) may under-quote a padded mailer plus insert. Quotes and labels now share `parcelFor()`: 2 oz for the first pack (owner's packed weight is 1 to 2 oz) plus 0.7 oz per extra (Kuba-Ventures/Nemat-Trading#121).
- [x] **2026-10-13** · **(growth)** Finance and Growth dashboards in the admin, fed by `GET /api/admin/metrics` (Stripe, orders, Meta insights), with a GA4 funnel, Ended campaign states and account links (Kuba-Ventures/Nemat-Trading#125, #126, #128, #129).
- [x] **2026-10-14** · **(growth)** Server-side Meta Purchase from the Stripe webhook via the Conversions API, deduplicated with the browser pixel and CAPI Gateway on the Stripe session id (`src/lib/metaCapi.ts`; Kuba-Ventures/Nemat-Trading#130, closes #127). Verified 2026-10-13 10:00 PM ET with a live $40.07 test order (refunded): Browser and Server Purchase, same event id.
- [x] **2026-10-14** · **(build)** Count Cash App Pay fees on the Finance page (`payment` balance transactions as well as `charge`; Kuba-Ventures/Nemat-Trading#131).
- [x] **2026-10-14** · **(design)** Live Finance and Growth pages: sync pill, Sync button, 60s auto-sync, 60s API cache (`src/lib/syncCache.ts`, `src/lib/syncStatus.ts`; Kuba-Ventures/Nemat-Trading#132).
- [x] **2026-10-14** · **(build)** "Shipped" state for orders sent without a Shippo label, no schema change (Kuba-Ventures/Nemat-Trading#133).
- [x] **2026-10-14** · **(growth)** Hand-credited orders count toward campaign Sales (`utm_medium=manual`; Kuba-Ventures/Nemat-Trading#134).
- [x] **2026-10-14** · **(design)** Admin sidebar separating Insights from Store (Kuba-Ventures/Nemat-Trading#135).
- [~] **started 2026-10-14** · **(growth)** Meta ads relaunch: "TTD Relaunch Oct - 14d - Sales" live since 2026-10-14, approved by Shawn. Finley is making new ad assets.
- [ ] **added 2026-10-14** · **(growth)** Confirm the first real relaunch order shows Purchase from both Browser and Server in Events Manager.
- [x] **2026-10-14** · **(growth)** Confirm `GA4_SERVICE_ACCOUNT_JSON` is set on Railway and the Growth funnel shows live data (not verified in #128). Set, owner confirmed 2026-10-14.
- [x] **2026-08-26** · **(build)** Google Ads MCP setup docs and scripts, local and Cloud Run (`docs/google-ads-mcp.md`, `scripts/setup-google-ads-mcp.sh`, `scripts/deploy-google-ads-mcp-cloudrun.sh`; Kuba-Ventures/Nemat-Trading#61 to #64).

## Stage 3: Keep the factory working (done, 2026-09-28 to 2026-10-02)

- [x] **2026-10-02** · **(build)** Fix `factory-review`, which failed before its first turn on every run from 2026-09-28 (Kuba-Ventures/Nemat-Trading#96). The cause was not the OAuth token: the floating `anthropics/claude-code-action@v1` tag moved that day to a broken release (v1.0.236, Claude Code 2.1.284). Fixed in Kuba-Ventures/Nemat-Trading#102:
  - The action is pinned to v1.0.239, SHA `97c53473391bff1901034d4b454b5bac7ab7a029`.
  - The enforce step runs even when the review step fails, so a failed review says so instead of passing silently.
  - Fail-open CI-change detection fixed.
  - APPROVE-LOWRISK now needs `reviewer_completed` plus the changed-path backstop; `CLAUDE.md` and `.claude/**` always escalate.
  - PRs #93 to #99 were hand-merged without a review. Kuba-Ventures/Nemat-Trading#96 closed 2026-10-02 after Kuba-Ventures/Nemat-Trading#104, the first code PR on the pinned SHA, got a real verdict (ESCALATE, `is_error: false`).
- [x] **2026-09-28** · **(build)** Tests in the factory gate: `tsx --test` in `api-server` and Vitest in `nemat-drop` (Kuba-Ventures/Nemat-Trading#98, Kuba-Ventures/Nemat-Trading#99).
- [x] **2026-10-02** · **(build)** Make a broken review fail loudly instead of passing silently (suggested in #96 as a real-call auth check; done instead by running the enforce step on failure in Kuba-Ventures/Nemat-Trading#102).

## Stage 4: Later (2026-10-02 to present)

- [x] **2026-10-02** · **(compliance)** Secure the Scryfall/TCGPlayer lookup routes in `src/routes/scryfall.ts`. Merged in Kuba-Ventures/Nemat-Trading#104 (2026-10-02): `/tcgplayer/debug` removed; `/lookup/tcgplayer`, `/scryfall/:id/price` and `/tcgplayer/price-check` behind `requireAdmin`; `/tcgplayer/price` stays public for the storefront with a rate limit (30 per 10 minutes per client, in-memory, keyed on the rightmost `X-Forwarded-For` entry) and URL validation.
- [ ] **added 2026-10-02** · **(build)** Move admin image uploads off Railway's ephemeral disk (Cloudinary is optional today; `src/routes/upload.ts`).
- [ ] **added 2026-10-02** · **(build)** Replace inline `ALTER TABLE` bootstrap migrations with a migration system (`src/index.ts`).
- [x] **2026-10-13** · **(compliance)** Replace the client-side `VITE_ADMIN_PASSWORD` gate, which ships in the browser bundle. Server-side login with a signed 12h token (Kuba-Ventures/Nemat-Trading#124). `VITE_ADMIN_PASSWORD` is gone from Vercel (checked with `vercel env ls`, 2026-10-14). `ADMIN_SECRET` was not rotated, by owner decision (2026-10-14); since it also signs admin tokens, the leaked value stays an accepted risk.

## Open questions

- Does Railway append the client IP to `X-Forwarded-For` (as the #104 rate limiter assumes) or overwrite the header? If it overwrites, the limiter key needs to change.

- ~~Has "Re-lock pull odds" been run on production?~~ Answered 2026-10-06: not for TMNT. The live product still has empty `possiblePulls` and tier rows with no percentages, so it still needs a run.
- Where does Postgres actually live? `README.md` says Railway; `CLAUDE.md` and `PROJECT.md` say Supabase.
- What is the next drop after the TMNT product, and is there a cadence for new drops?
- ~~Are Meta ads being attributed now that #100 is live, and what should the admin show?~~ Answered 2026-10-14: Meta received browser and Gateway Purchase events throughout; it missed only the 2026-09-30 Cash App Pay sale, which never loaded the pixel. Server-side CAPI (#130) closes that gap, and the Growth page shows orders by source and hand-credited sales (#125, #134).
- ~~Which thank-you insert format (1 trading card, 2 postcard, 3 sealed fold), what code name, what discount % and what limits? Waiting on Shawn (emailed 2026-10-07).~~ Answered 2026-10-07: format 1, `TOPDECK10`, 10% off, one use per customer (#117).
- ~~Will Shawn OK automatic USPS postage purchase on every order (#113), and what is the full origin address and packed parcel size and weight?~~ Answered 2026-10-13: the owner first chose fully automatic (#121), then Shawn asked for click-to-buy (#123). The origin address is set; packed weight is 1 to 2 oz.
- Did the 2026-10-14 Meta developer account lock also affect the server-side CAPI token? Confirm on the first real relaunch order.
- ~~Should the factory pin `anthropics/claude-code-action` to a version instead of the floating `@v1` tag?~~ Answered: yes, pinned to the v1.0.239 SHA in Kuba-Ventures/Nemat-Trading#102.
