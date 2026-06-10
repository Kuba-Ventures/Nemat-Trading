# Nemat Trading

pnpm monorepo. Vite/React frontend (`artifacts/nemat-drop`) deploys to Vercel; Express API
(`artifacts/api-server`) deploys to Railway; shared DB layer in `lib/db` (Drizzle + raw SQL
migrations against a Supabase-hosted Postgres). Stripe checkout + webhooks, Shippo shipping,
Google Apps Script sheet sync, Anthropic + remove.bg integrations.

## Merge policy

This repo runs a supervised PR factory. A PR auto-merges only when the factory review
returns APPROVE-LOWRISK against this policy.

**Low-risk surfaces (eligible for auto-merge):**
- `artifacts/nemat-drop/src/components/**` — presentational React components,
  **excluding** anything touching checkout, payment, cart, or pricing
- Static assets (images, fonts, icons) under `artifacts/nemat-drop/`
- Markdown docs (`**/*.md`)

**Always escalate to a human (never auto-merge), regardless of how small the change:**
- Anything touching trust, money, auth, sessions, secrets, billing, or pricing
  (all Stripe, checkout, and cart code)
- `artifacts/api-server/**` — the entire Express backend
- `lib/db/**` — database schema, migrations, or data deletion/retention
- Access control / permissions
- CI, workflows, build config, or dependency changes
- Anything outside the low-risk surfaces above

The reviewer (`.claude/agents/pr-reviewer.md`) is the source of truth for how this policy
is enforced. Tighten this block whenever something slips through.
