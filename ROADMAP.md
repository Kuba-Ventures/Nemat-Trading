# Tommy Top Decker Trading Roadmap: turn paid ad traffic into attributable, repeatable drops

*Owner: Finley · Started: 2026-10-02 · Status: live and taking orders, ad attribution just shipped, review gate fixed and verified, lookup routes secured, 2026-10-06 CORS outage fixed (Railway `FRONTEND_URL` now apex + www, Stripe redirect fix in #110, verified by a prod test checkout), every item dated · last verified against the code and merged PRs 2026-10-06*

## What this is

Tommy Top Decker Trading (repo: Nemat-Trading) is a Magic: The Gathering booster-pack drop storefront at tommytopdecker.com for collectors buying one featured product at a time. Buyers see derived pull odds, get live USPS shipping quotes, and pay with Stripe Checkout. The frontend is Vite + React on Vercel (`artifacts/nemat-drop`), the API is Express 5 on Railway (`artifacts/api-server`), and data lives in Postgres via Drizzle (`lib/db`), with orders and signups mirrored to a Google Sheet.

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
- **2026-10-01** · Meta click id and UTM tags recorded on every order (#100).
- **2026-10-02** · ROADMAP.md added (#101). Factory review pinned to a SHA (#102); its first real verdict on #104 closed #96. Admin lookup routes locked down and the public price route rate limited (#104).
- **2026-10-06** · CORS outage: the API allowed only www while the site serves from apex, so the storefront showed a stale fallback product. Fixed by setting Railway `FRONTEND_URL` to apex + www; checkout then took only the first entry as its Stripe redirect base (#110).

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
- [ ] **added 2026-10-02** · **(growth)** Surface attribution in the admin. The order APIs do not return the new columns yet (per #100).
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
- [ ] **added 2026-10-02** · **(compliance)** Replace the client-side `VITE_ADMIN_PASSWORD` gate, which ships in the browser bundle.

## Open questions

- Does Railway append the client IP to `X-Forwarded-For` (as the #104 rate limiter assumes) or overwrite the header? If it overwrites, the limiter key needs to change.

- ~~Has "Re-lock pull odds" been run on production?~~ Answered 2026-10-06: not for TMNT. The live product still has empty `possiblePulls` and tier rows with no percentages, so it still needs a run.
- Where does Postgres actually live? `README.md` says Railway; `CLAUDE.md` and `PROJECT.md` say Supabase.
- What is the next drop after the TMNT product, and is there a cadence for new drops?
- Are Meta ads being attributed now that #100 is live, and what should the admin show?
- ~~Should the factory pin `anthropics/claude-code-action` to a version instead of the floating `@v1` tag?~~ Answered: yes, pinned to the v1.0.239 SHA in Kuba-Ventures/Nemat-Trading#102.
