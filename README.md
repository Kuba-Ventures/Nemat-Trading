# TommyTopDecker Trading

Magic: The Gathering booster pack drop site. Customers browse a product, get live USPS shipping quotes, and check out via Stripe. Completed orders are written to a PostgreSQL database and appended to a Google Sheet via Apps Script. An admin panel on the frontend lets you manage products and view subscribers.

---

## Tech stack

| Layer | Technology | Deployed to |
|---|---|---|
| Frontend | Vite + React + Tailwind | Vercel (tommytopdecker.com) |
| API server | Express 5 + TypeScript | Railway |
| Database | PostgreSQL + Drizzle ORM | Railway (Postgres service) |
| Payments | Stripe Checkout | — |
| Shipping | Shippo (USPS rates) | — |
| Order sync | Google Apps Script webhook | — |
| Image backgrounds | remove.bg API | — |
| Card intel | Anthropic Claude API | — |

---

## Monorepo layout

```
artifacts/
  nemat-drop/       Frontend (Vite/React). Deploys to Vercel.
  api-server/       Express API. Deploys to Railway.
  mockup-sandbox/   Internal dev tool — not deployed.
lib/
  db/               Drizzle schema + pg pool. Imported as @workspace/db.
  api-zod/          Shared Zod schemas.
  api-client-react/ Generated React-Query hooks from OpenAPI spec.
  api-spec/         openapi.yaml + Orval config.
scripts/            Utility scripts (post-merge hook, etc).
```

---

## Quick start (local dev)

**Prerequisites:** Node 20+, pnpm, a running PostgreSQL instance.

```bash
# Install all workspace dependencies
pnpm install

# Copy the env template and fill in the blanks (see Environment variables below)
cp .env.example .env

# Run the API server
cd artifacts/api-server
pnpm dev          # starts on PORT (required — set it in .env)

# In a separate terminal, run the frontend
cd artifacts/nemat-drop
pnpm dev          # starts on port 5173 by default
```

The API server runs database migrations automatically on startup — no separate migration step needed in local dev.

To run Drizzle Kit commands (schema inspection, manual migrations):

```bash
cd lib/db
DATABASE_URL=<your-local-db-url> pnpm dlx drizzle-kit studio
```

---

## Environment variables

### Railway (API server)

Set these in the Railway service's "Variables" panel.

| Variable | Required | Description | How to get it |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | PostgreSQL connection string. Railway auto-injects this when you link a Postgres service. | Railway dashboard → your Postgres service → Connect tab |
| `PORT` | **Yes** | Port the Express server listens on. Railway injects this automatically — do not set a fixed value. | Injected by Railway |
| `STRIPE_SECRET_KEY` | **Yes** | Stripe secret key used to create Checkout Sessions and retrieve session details. Use `sk_test_…` in staging, `sk_live_…` in production. | [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys) |
| `STRIPE_WEBHOOK_SECRET` | **Yes** | Signing secret for verifying incoming Stripe webhook events. Webhooks will be rejected without this. | Stripe dashboard → Developers → Webhooks → your endpoint → Signing secret |
| `SHIPPO_API_TOKEN` | **Yes** | Authenticates requests to the Shippo API for USPS rate quotes and rate re-validation at checkout. | [goshippo.com](https://goshippo.com) → API |
| `ADMIN_SECRET` | **Yes** | Signs the 12-hour admin session tokens that `/admin` sends as `x-admin-key` on every admin endpoint. Rotating it signs everyone out. Never put it in the frontend. | Generate with `openssl rand -hex 32` |
| `ADMIN_PASSWORD` | **Yes** | The `/admin` login password. Checked server-side by `POST /api/admin/login` (rate limited), which returns a signed token. | Choose a strong password |
| `ADMIN_ACCEPT_LEGACY_KEY` | Optional | Set to `1` only during a rollout to also accept the raw `ADMIN_SECRET` as `x-admin-key`. Off by default; remove it afterwards. | `1` or unset |
| `LABEL_LINK_SECRET` | **Yes** | Signs the "Buy label" links in sales@ order emails. Falls back to `ADMIN_SECRET` if unset. | Generate with `openssl rand -hex 32` |
| `FRONTEND_URL` | **Yes** | Comma-separated list of frontend origins. Every entry goes into the API's CORS allowlist; the first entry is the base for Stripe's `success_url` and `cancel_url` redirects. List the primary domain first and include both apex and www, or browsers on the missing origin get CORS errors. | Your Vercel domains, e.g. `https://tommytopdecker.com,https://www.tommytopdecker.com` |
| `SHEETS_WEBHOOK_URL` | Optional | Full URL of the deployed Google Apps Script web app. When set, new subscribers and completed orders are appended to the linked Google Sheet. Silently skipped if absent. | Deploy the Apps Script as a web app → copy the URL |
| `SHEETS_WEBHOOK_SECRET` | Optional | Shared secret sent in the request body to the Apps Script endpoint for basic authentication. Must match the constant defined in the Apps Script source. | Choose a value and set the same value in the Apps Script |
| `SHIPPING_ORIGIN_ZIP` | Optional | 5-digit US ZIP code used as the ship-from address for Shippo rate calculations. Defaults to `94303`. | Set to your actual fulfillment ZIP code |
| `PRODUCT_WEIGHT_OZ` | Optional | Per-unit product weight in ounces used for Shippo parcel dimensions. Defaults to `0.7`. | Weigh a single pack |
| `API_BASE_URL` | Optional | Base URL prepended to uploaded image paths returned by `POST /api/admin/upload`. If unset, paths are returned relative (e.g. `/uploads/filename.jpg`). Only matters if you serve uploads from a CDN. | Your Railway service's public URL |
| `ANTHROPIC_API_KEY` | Optional | Used by the card-intel endpoint in `scryfall.ts` to call Claude. Returns 503 if not set. | [console.anthropic.com](https://console.anthropic.com) |
| `REMOVE_BG_API_KEY` | Optional | Used by the background-removal endpoint in `scryfall.ts`. Returns 503 if not set. | [remove.bg/api](https://www.remove.bg/api) |
| `AI_HEALTH_ALERT_TO` | Optional | Comma-separated team addresses (qsbsrollover.com only) for the daily dependency health email. Defaults to `finley@qsbsrollover.com`. Sent with `RESEND_API_KEY` from `ORDER_EMAIL_FROM`. | Team addresses |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_UPLOAD_PRESET` | Optional | Used only by the Cloudinary health check. Default to the public values the storefront ships. | Same as the Vercel `VITE_CLOUDINARY_*` values |

---

### Vercel (frontend)

Set these in the Vercel project's "Environment Variables" panel. All must be prefixed `VITE_` to be exposed to the browser bundle.

| Variable | Required | Description | How to get it |
|---|---|---|---|
| `VITE_API_URL` | **Yes** | Full base URL of the Railway API server (no trailing slash). Every API call in the frontend is prefixed with this. | Your Railway service's public URL, e.g. `https://api.tommytopdecker.com` |
| `VITE_CLOUDINARY_CLOUD_NAME` | Optional | Cloudinary cloud name for direct browser-to-Cloudinary image uploads in the admin panel. If unset, the admin image upload UI falls back to the server-side upload endpoint (`/api/admin/upload`). | [cloudinary.com](https://cloudinary.com) → Dashboard |
| `VITE_CLOUDINARY_UPLOAD_PRESET` | Optional | Cloudinary unsigned upload preset name. Required if `VITE_CLOUDINARY_CLOUD_NAME` is set. | Cloudinary → Settings → Upload → Upload presets |

---

### Local dev only

These are not deployed — they only affect your local environment.

| Variable | Description |
|---|---|
| `DATABASE_URL` | Connection string for your local Postgres database. Set this in your shell or a `.env` file that the api-server loads. |
| `PORT` | Overrides the port the API server listens on (required — the server throws on startup without it). Use e.g. `3000`. |
| `FRONTEND_URL` | Set to `http://localhost:5173` so CORS allows the local frontend and Stripe success/cancel redirects land locally. |

---

## API endpoints

All routes are mounted under `/api`.

### Public

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/healthz` | Health check. Returns `{ status: "ok" }`. |
| `GET` | `/api/products` | Returns all active products. |
| `POST` | `/api/subscribe` | Adds an email to the waitlist. Body: `{ email }`. |
| `POST` | `/api/shipping/rates` | Returns USPS rate options. Body: `{ productId, quantity, destinationZip }`. |
| `POST` | `/api/checkout` | Creates a Stripe Checkout Session. Body: `{ productId, quantity, shippingRateId }`. Returns `{ url }`. `shippingRateId` must come from `/api/shipping/rates` — the server re-fetches the rate from Shippo to prevent price tampering. |
| `POST` | `/api/webhooks/stripe` | Stripe webhook receiver. Records completed orders to the DB and appends a row to the Orders sheet. Requires a valid Stripe signature. |

### Card intel / TCGPlayer

Everything here except `/api/tcgplayer/price` requires the `x-admin-key: <ADMIN_SECRET>` header.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/tcgplayer/price` | Public, rate limited (30 per 10 min per client) | Live TCGPlayer price for the storefront. Body: `{ url }`, a `tcgplayer.com/product/<id>/...` URL. Returns `{ lowestPrice }` only. |
| `GET` | `/api/scryfall/:id/price` | Admin | Scryfall price for a card UUID. |
| `GET` | `/api/tcgplayer/price-check?id=<productId>` | Admin | Spot-check the TCGPlayer price and image for a product ID. |
| `POST` | `/api/lookup/tcgplayer` | Admin | Full TCGPlayer lookup with enrichment (admin product form). Body: `{ url }`. |
| `POST` | `/api/intel-report/restyle` | Admin | Calls Claude to restyle an intel report. Requires `ANTHROPIC_API_KEY`. Returns 503 if key absent. |
| `POST` | `/api/remove-background` | Admin | Removes image background via remove.bg. Requires `REMOVE_BG_API_KEY`. Returns 503 if key absent. |

### Admin (requires `x-admin-key: <ADMIN_SECRET>` header)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/products` | Lists all products including inactive ones. |
| `POST` | `/api/admin/products` | Creates a product. |
| `PATCH` | `/api/admin/products/:id` | Updates a product. |
| `DELETE` | `/api/admin/products/:id` | Deletes a product. |
| `GET` | `/api/admin/subscribers` | Lists all waitlist subscribers. |
| `POST` | `/api/admin/sync-sheets` | Backfills all subscribers and orders to the Google Sheet. Clear existing data rows in the sheet before running to avoid duplicates. |
| `POST` | `/api/admin/upload` | Accepts a multipart image upload (max 10 MB) and saves it to `uploads/` on the server. Returns `{ url }`. |
| `GET` | `/api/admin/dependency-health` | Health report for the admin Health and Map views: per dependency status, last check, reply time, balance, 7 day timeline, uptime and incidents, which required secrets are set (never their values), plus `downCount` and `warningCount`. |

### Dependency health checks

Everything the shop depends on is checked every 10 minutes with its real keys, using the cheapest authenticated read each service offers: nothing is charged, no label is bought, no email is sent and no row is written outside `ai_service_checks`. Anthropic has no API for remaining prepaid credit, so running out is only visible to a live request.

| Dependency | Check |
|---|---|
| Vercel storefront | `GET` the first `FRONTEND_URL` entry |
| Stripe | `GET /v1/balance` (a restricted key without balance access reads as "can't check", not down) |
| Supabase database | `SELECT 1` through the existing pool |
| Shippo | `GET /carrier_accounts?results=1` |
| Resend | `GET /domains`: the `ORDER_EMAIL_FROM` domain must be verified (a sending-only key reads as "can't check") |
| Google Sheets log | No test rows: `src/lib/sheets.ts` records each real webhook call, and the check shows when it last worked. No call yet is unknown, never down |
| Claude | One `max_tokens: 1` request to `claude-haiku-5-5` with `ANTHROPIC_API_KEY` |
| remove.bg | Free `GET /v1.0/account` balance read. Under one credit is down; credits lasting about 7 days or less at this week's pace is "running low" |
| Cloudinary | An unsigned upload with the preset and no file, which Cloudinary rejects before storing anything; "Missing required parameter - file" proves the cloud name and preset. Usage needs an API secret the shop doesn't have, so it shows "can't check usage" and is never down. Reads `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_UPLOAD_PRESET`, defaulting to the public values the storefront already ships |
| Railway API server | Checked from outside Railway, see below |

- **Scheduler:** in process, like the scorecard and Meta ads check (`startDependencyHealthScheduler` in `src/lib/dependencyHealthJob.ts`), first run a minute after boot. Off when `NODE_ENV=development`.
- **Storage:** one row per dependency per check in `ai_service_checks` (created by the bootstrap in `src/index.ts`, RLS on), with `limit_remaining`, `limit_unit` and `note` for balances and notes.
- **Email:** at most one per Pacific day across every dependency (Resend idempotency key `dependency-health-<day>`), listing everything down now, anything running low and anything that recovered since the last email. An outage still going the next day is mentioned again; a recovery after that day's email waits for the next one. Credit, quota, key and domain failures count on the first failed check; outages, rate limits and network errors need two in a row. Recipients: `AI_HEALTH_ALERT_TO`, team (qsbsrollover) addresses only, default `finley@qsbsrollover.com`. Every read the decision depends on goes straight to Postgres and a failed read stops the run.
- **Outside watcher:** `artifacts/nemat-drop/api/cron/watch-railway.ts`, a Vercel Cron function on the storefront project (`*/10 * * * *` in `artifacts/nemat-drop/vercel.json`). It calls `/api/healthz`, reads the newest Railway check from Supabase, records its own `api` row, and emails through Resend directly when the API doesn't answer twice in a row or has recorded nothing for 30 minutes. It keeps its own once-a-day budget, so a Railway outage is never silenced by an earlier email from the API. Needs `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` and `RESEND_API_KEY` on Vercel, plus the existing `VITE_API_URL` and `VITE_SUPABASE_URL`.
- **Admin:** `/admin?view=health` (everything in one list, grouped by what it powers, plus which required secrets are set) and `/admin?view=health-map` (map from storefront to API to services, and what that means for customers). A red banner on the other admin pages and a badge on Health while anything is down. When the API itself doesn't answer, everything behind it shows grey "can't check while the API is down".
- **Files:** `src/lib/dependencyChecks.ts`, `dependencyLimits.ts`, `dependencyAlerts.ts`, `dependencySummary.ts`, `dependencyHealthJob.ts`, `src/routes/dependencyHealth.ts`; front end `src/lib/dependencyHealth.ts` (the catalog: one line per dependency, including its map position) and `src/pages/adminHealth.tsx`.

---

## Deployment

### Railway (API server)

- Build is defined in `nixpacks.toml`: installs deps with `pnpm install --no-frozen-lockfile`, builds with `pnpm --filter @workspace/api-server run build`, starts with `node artifacts/api-server/dist/index.cjs`.
- `railway.json` mirrors the start command and sets restart policy to `ON_FAILURE`.
- Database migrations run automatically at server startup via raw SQL in `src/index.ts`. Schema is additive (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) — safe to redeploy without data loss.
- Set all Railway environment variables listed above before the first deploy.

### Vercel (frontend)

- Build command (from `vercel.json`): `cd ../.. && pnpm install --no-frozen-lockfile && pnpm --filter @workspace/nemat-drop run build`
- Output directory: `dist/public` (relative to `artifacts/nemat-drop`)
- SPA routing is handled by a catch-all rewrite to `/index.html`.
- The Vercel project root should be set to `artifacts/nemat-drop`.

### Stripe webhook

After deploying, register the webhook endpoint in the Stripe dashboard:

- URL: `https://<your-railway-url>/api/webhooks/stripe`
- Event: `checkout.session.completed`
- Copy the signing secret into `STRIPE_WEBHOOK_SECRET` in Railway.

---

## Google Sheets integration

Order completions and waitlist signups are pushed to a Google Sheet via a deployed Apps Script web app. The Apps Script receives a POST with `{ tab, row, secret }` and appends the row to the named sheet tab. The two tabs and their column order:

- **`"Email List"`** (waitlist) — `Timestamp · Email · Location · Status`
  - `Location` is best-effort geolocated from the visitor's IP at signup (via `ip-api.com`); blank if it can't be resolved. Requires `app.set("trust proxy", true)` so `req.ip` is the real client IP behind Railway's proxy.
  - `Status` is written as `Member` by default; it's a manual dropdown (`Admin`/`Member`) you can override in the sheet.
- **`"Orders"`** — `Timestamp · Order ID · Email · Order Count · Phone · Name · Item · Subtotal · Shipping · Tax · Tax Rate · Total · Currency · Ship To Name · Address 1 · Address 2 · City · State · ZIP · Country · Payment Intent`
  - All pulled from the completed Stripe Checkout session. `Phone` requires `phone_number_collection` on the checkout session (enabled in `routes/checkout.ts`).

Config:

- `SHEETS_WEBHOOK_URL`: the deployed Apps Script URL (from Script editor → Deploy → Manage deployments)
- `SHEETS_WEBHOOK_SECRET`: a shared secret hardcoded in both Railway env vars and the Apps Script source — must match exactly
- The Apps Script must have sheet tabs named exactly `Email List` and `Orders` (it appends via `getSheetByName(tab)`)
- Sheet sync is non-blocking: a failure does not affect the HTTP response to the client or Stripe

---

## Known issues / gotchas

- **Admin sessions last 12 hours and live in sessionStorage.** Closing the tab or rotating `ADMIN_SECRET` signs the admin out. No admin secret is in the browser bundle; never add one as a `VITE_` variable.
- **Uploaded images are ephemeral on Railway.** Files saved to `uploads/` live on the Railway container's local filesystem. They are lost on redeploy. Use Cloudinary (via the `VITE_CLOUDINARY_*` vars) for persistent image hosting in production.
- **Shipping rates expire.** Shippo rate IDs are short-lived. The frontend should call `/api/shipping/rates` and proceed to `/api/checkout` in the same session — do not cache rate IDs.
- **Sheet backfill duplicates.** `POST /api/admin/sync-sheets` appends — it does not deduplicate. Clear the data rows in the sheet before running a backfill.
- **Database migrations are inline SQL.** Schema changes must be written as additive `ADD COLUMN IF NOT EXISTS` statements in `src/index.ts` or they will fail on a live database with existing data.
