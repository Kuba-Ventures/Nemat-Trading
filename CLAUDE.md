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

# Working style (personal)

Shape every response for a reader with ADHD — lead with the concrete next
action; number multi-step work; externalize what's done vs left; suppress
tangents; give specific time estimates ("~5 min"); make progress visible.
For design/UI work, present exactly three options (A, B, C) with one-line
rationales and wait for a choice before building.

<!-- BEGIN STANDARD -->
## Response style
- Lead with the concrete next action, before context or caveats.
- Number multi-step work.
- Restate what's done and what's left each turn.
- No tangents or "you might also consider."
- Time estimates as specifics ("~5 min").
- Call out completed steps explicitly.

## Design and UI work
Any product or feature change with a visual surface: present exactly three
options (A, B, C), one-line rationale each. Render them — never describe
them in prose. Build each as a working preview and open all three side by
side in a browser. `/design-shotgun` does this end to end.
Stop and wait for a choice before building anything further.

## Git workflow
- Never commit to `main`. Branch as `claude/<description>`.
- One PR per logical change — don't mix chores into feature branches.
- Delete the branch after merge.
<!-- END STANDARD -->
