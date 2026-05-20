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
| `ADMIN_SECRET` | **Yes** | Arbitrary secret string checked via the `x-admin-key` request header on all `/api/admin/*` endpoints. Choose a strong random value. | Generate with `openssl rand -hex 32` |
| `FRONTEND_URL` | **Yes** | The public URL of the frontend. Used to build Stripe's `success_url` and `cancel_url` redirects. | Your Vercel deployment URL, e.g. `https://tommytopdecker.com` |
| `SHEETS_WEBHOOK_URL` | Optional | Full URL of the deployed Google Apps Script web app. When set, new subscribers and completed orders are appended to the linked Google Sheet. Silently skipped if absent. | Deploy the Apps Script as a web app → copy the URL |
| `SHEETS_WEBHOOK_SECRET` | Optional | Shared secret sent in the request body to the Apps Script endpoint for basic authentication. Must match the constant defined in the Apps Script source. | Choose a value and set the same value in the Apps Script |
| `SHIPPING_ORIGIN_ZIP` | Optional | 5-digit US ZIP code used as the ship-from address for Shippo rate calculations. Defaults to `94303`. | Set to your actual fulfillment ZIP code |
| `PRODUCT_WEIGHT_OZ` | Optional | Per-unit product weight in ounces used for Shippo parcel dimensions. Defaults to `0.7`. | Weigh a single pack |
| `API_BASE_URL` | Optional | Base URL prepended to uploaded image paths returned by `POST /api/admin/upload`. If unset, paths are returned relative (e.g. `/uploads/filename.jpg`). Only matters if you serve uploads from a CDN. | Your Railway service's public URL |
| `ANTHROPIC_API_KEY` | Optional | Used by the card-intel endpoint in `scryfall.ts` to call Claude. Returns 503 if not set. | [console.anthropic.com](https://console.anthropic.com) |
| `REMOVE_BG_API_KEY` | Optional | Used by the background-removal endpoint in `scryfall.ts`. Returns 503 if not set. | [remove.bg/api](https://www.remove.bg/api) |

---

### Vercel (frontend)

Set these in the Vercel project's "Environment Variables" panel. All must be prefixed `VITE_` to be exposed to the browser bundle.

| Variable | Required | Description | How to get it |
|---|---|---|---|
| `VITE_API_URL` | **Yes** | Full base URL of the Railway API server (no trailing slash). Every API call in the frontend is prefixed with this. | Your Railway service's public URL, e.g. `https://api.tommytopdecker.com` |
| `VITE_ADMIN_PASSWORD` | **Yes** | Password checked client-side on the `/admin` page before rendering admin UI. This is a lightweight gate — it is not a substitute for server-side auth on the admin endpoints (which use `ADMIN_SECRET` via `x-admin-key`). | Choose any value; set `ADMIN_SECRET` to a separate independent value on the server |
| `VITE_CLOUDINARY_CLOUD_NAME` | Optional | Cloudinary cloud name for direct browser-to-Cloudinary image uploads in the admin panel. If unset, the admin image upload UI falls back to the server-side upload endpoint (`/api/admin/upload`). | [cloudinary.com](https://cloudinary.com) → Dashboard |
| `VITE_CLOUDINARY_UPLOAD_PRESET` | Optional | Cloudinary unsigned upload preset name. Required if `VITE_CLOUDINARY_CLOUD_NAME` is set. | Cloudinary → Settings → Upload → Upload presets |

---

### Local dev only

These are not deployed — they only affect your local environment.

| Variable | Description |
|---|---|
| `DATABASE_URL` | Connection string for your local Postgres database. Set this in your shell or a `.env` file that the api-server loads. |
| `PORT` | Overrides the port the API server listens on (required — the server throws on startup without it). Use e.g. `3000`. |
| `FRONTEND_URL` | Set to `http://localhost:5173` so Stripe success/cancel redirects land locally. |

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

### Card intel / TCGPlayer (internal tools — no auth required)

These endpoints are used by the admin panel for card research. They are unauthenticated — consider adding `requireAdmin` if the server is exposed publicly.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/scryfall/:id/price` | Fetches price data for a Scryfall card ID. |
| `POST` | `/api/tcgplayer/price` | Looks up a TCGPlayer price. Body: `{ name }`. |
| `GET` | `/api/tcgplayer/price-check` | Spot-check TCGPlayer price for a given query param. |
| `GET` | `/api/tcgplayer/debug` | Debug endpoint for TCGPlayer scraping. |
| `POST` | `/api/lookup/tcgplayer` | Full TCGPlayer lookup with enrichment. Body: `{ name }`. |
| `POST` | `/api/intel-report/restyle` | Calls Claude to generate a card intel report. Requires `ANTHROPIC_API_KEY`. Body: `{ name }`. Returns 503 if key absent. |
| `POST` | `/api/remove-background` | Removes card image background via remove.bg. Requires `REMOVE_BG_API_KEY`. Returns 503 if key absent. |

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

Order completions and waitlist signups are pushed to a Google Sheet via a deployed Apps Script web app. The Apps Script receives a POST with `{ tab, row, secret }` and appends the row to the named sheet tab (`"Waitlist"` or `"Orders"`).

- `SHEETS_WEBHOOK_URL`: the deployed Apps Script URL (from Script editor → Deploy → Manage deployments)
- `SHEETS_WEBHOOK_SECRET`: a shared secret hardcoded in both Railway env vars and the Apps Script source — must match exactly
- Sheet sync is non-blocking: a failure does not affect the HTTP response to the client or Stripe

---

## Known issues / gotchas

- **Admin password is client-side only.** `VITE_ADMIN_PASSWORD` is compiled into the browser bundle and is visible to anyone who inspects the JS. The real security for admin mutations is `ADMIN_SECRET` on the server side. Do not rely on `VITE_ADMIN_PASSWORD` for anything sensitive.
- **Uploaded images are ephemeral on Railway.** Files saved to `uploads/` live on the Railway container's local filesystem. They are lost on redeploy. Use Cloudinary (via the `VITE_CLOUDINARY_*` vars) for persistent image hosting in production.
- **Shipping rates expire.** Shippo rate IDs are short-lived. The frontend should call `/api/shipping/rates` and proceed to `/api/checkout` in the same session — do not cache rate IDs.
- **Sheet backfill duplicates.** `POST /api/admin/sync-sheets` appends — it does not deduplicate. Clear the data rows in the sheet before running a backfill.
- **Database migrations are inline SQL.** Schema changes must be written as additive `ADD COLUMN IF NOT EXISTS` statements in `src/index.ts` or they will fail on a live database with existing data.
