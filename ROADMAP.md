# Tommy Top Decker Trading Roadmap: turn paid ad traffic into attributable, repeatable drops

*Owner: Finley · Started: 2026-10-02 · Status: live and taking orders, ad attribution just shipped, review gate broken · last verified against the code 2026-10-02*

## What this is

Tommy Top Decker Trading (repo: Nemat-Trading) is a Magic: The Gathering booster-pack drop storefront at tommytopdecker.com for collectors buying one featured product at a time. Buyers see derived pull odds, get live USPS shipping quotes, and pay with Stripe Checkout. The frontend is Vite + React on Vercel (`artifacts/nemat-drop`), the API is Express 5 on Railway (`artifacts/api-server`), and data lives in Postgres via Drizzle (`lib/db`), with orders and signups mirrored to a Google Sheet.

### Status legend

- [ ] not started · [~] in progress · [x] done
- Tags: **(design)** **(build)** **(growth)** **(compliance)**
- ⚠️ = critical path

## Stage 0: Storefront and checkout (done)

- [x] **(build)** Product page, Shippo USPS quotes, Stripe Checkout with server-side rate re-validation (`src/routes/shipping.ts`, `src/routes/checkout.ts`).
- [x] **(build)** Stripe webhook writes orders to Postgres and the Orders sheet (`src/routes/webhooks.ts`, `src/lib/sheets.ts`).
- [x] **(build)** Max 2 per item per order, enforced server-side (`MAX_QUANTITY_PER_ORDER` in `src/routes/checkout.ts`).
- [x] **(build)** Customer accounts with order history via Supabase auth (`src/pages/account.tsx`, `src/lib/supabaseAuth.ts`).
- [x] **(build)** Admin panel for products, orders, and waitlist, gated server-side by `x-admin-key` (`src/pages/admin.tsx`, `src/routes/products.ts`).

## Stage 1: Pull odds and drop mechanics (done)

- [x] **(build)** Pull probabilities derived from pack contents plus live Scryfall data, with a "Re-lock pull odds" backfill (`src/routes/scryfall.ts`, `POST /api/admin/products/relock-pulls`).
- [x] **(build)** One shared TCGPlayer price figure, no seed fallback (Kuba-Ventures/Nemat-Trading#65, Kuba-Ventures/Nemat-Trading#66).
- [x] **(build)** Rolling 10-day drop deadline that rolls forward instead of expiring (`src/lib/drop-window.ts`; Kuba-Ventures/Nemat-Trading#77, Kuba-Ventures/Nemat-Trading#86).
- [x] **(design)** One countdown per screen, mobile purchase bar, phone layout fixes (Kuba-Ventures/Nemat-Trading#76, #88, #97).
- [x] **(compliance)** Accessibility fixes for contrast and form labels (Kuba-Ventures/Nemat-Trading#80, Kuba-Ventures/Nemat-Trading#83).
- [x] **(growth)** Share card and real page metadata (Kuba-Ventures/Nemat-Trading#82).

## Stage 2: Order emails and ad attribution (in progress)

- [x] **(build)** Resend sales alert and pack-themed customer confirmation email on every order (`src/lib/orderEmail.ts`; Kuba-Ventures/Nemat-Trading#93, #94, #95).
- [x] **(growth)** GTM container with real Purchase value pushed to `dataLayer` on `/success` (`index.html`, Kuba-Ventures/Nemat-Trading#60). The direct Meta Pixel + CAPI code was added and then reverted (Kuba-Ventures/Nemat-Trading#58, #59).
- [x] **(growth)** Capture `fbclid`, `_fbc`/`_fbp`, and `utm_*` on landing and store them on each order (`src/lib/attribution.ts` in both apps; Kuba-Ventures/Nemat-Trading#100).
- [ ] **(growth)** Surface attribution in the admin. The order APIs do not return the new columns yet (per #100).
- [x] **(build)** Google Ads MCP setup docs and scripts, local and Cloud Run (`docs/google-ads-mcp.md`, `scripts/setup-google-ads-mcp.sh`, `scripts/deploy-google-ads-mcp-cloudrun.sh`).

## Stage 3: Keep the factory working (next)

- [ ] ⚠️ **(build)** Fix `factory-review`, which fails before its first turn on every run since 2026-09-28. Likely an expired `CLAUDE_CODE_OAUTH_TOKEN` (Kuba-Ventures/Nemat-Trading#96). PRs #93 to #95 were merged by hand.
- [x] **(build)** Tests in the factory gate: `tsx --test` in `api-server` and Vitest in `nemat-drop` (Kuba-Ventures/Nemat-Trading#98, Kuba-Ventures/Nemat-Trading#99).
- [ ] **(build)** Make the auth-check step do a real call so an expired token fails loudly (suggested in #96).

## Stage 4: Later

- [ ] **(compliance)** Put the remaining Scryfall/TCGPlayer lookup routes behind `requireAdmin`. `/scryfall/:id/price`, `/tcgplayer/*`, and `/lookup/tcgplayer` are still public (`src/routes/scryfall.ts`); only `intel-report/restyle` and `remove-background` are gated.
- [ ] **(build)** Move admin image uploads off Railway's ephemeral disk (Cloudinary is optional today; `src/routes/upload.ts`).
- [ ] **(build)** Replace inline `ALTER TABLE` bootstrap migrations with a migration system (`src/index.ts`).
- [ ] **(compliance)** Replace the client-side `VITE_ADMIN_PASSWORD` gate, which ships in the browser bundle.

## Open questions

- Has "Re-lock pull odds" been run on production? PROJECT.md (last updated 2026-06-12) lists it as the one remaining step and nothing in the repo records it.
- Where does Postgres actually live? `README.md` says Railway; `CLAUDE.md` and `PROJECT.md` say Supabase.
- What is the next drop after the TMNT product, and is there a cadence for new drops?
- Are Meta ads being attributed now that #100 is live, and what should the admin show?
- Should the factory pin `anthropics/claude-code-action` to a version instead of the floating `@v1` tag?
