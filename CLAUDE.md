# Nemat Trading

pnpm monorepo. Vite/React frontend (`artifacts/nemat-drop`) deploys to Vercel; Express API
(`artifacts/api-server`) deploys to Railway; shared DB layer in `lib/db` (Drizzle + raw SQL
migrations against a Supabase-hosted Postgres). Stripe checkout + webhooks, Shippo shipping,
Google Apps Script sheet sync, Anthropic + remove.bg integrations.

## Initiative and previews

These are the owner's standing preferences. This repo's merge policy and the rules below it still apply and take precedence where they conflict.

- **Do it, don't tell me to do it.** If a step can be done directly (clicking through a dashboard in the browser, running a CLI, calling an MCP or API), do it instead of handing the owner instructions. This covers Vercel, Railway, Supabase, Stripe, Shippo, Resend, Cloudinary, Google Apps Script and Sheets, Google Tag Manager, Meta Ads, Google Ads, Anthropic and GitHub.
- **Verify before reporting.** Open dashboards, check settings, pull logs and run read-only queries to confirm results yourself.
- **Make routine, reversible changes** that are part of the request without asking: toggling settings, creating webhooks or segments, redeploying, opening PRs.
- **Stop and ask first** before spending money (ad budgets, launching or editing live campaigns, purchases), sending messages as the owner, entering live API keys, passwords or 2FA codes, DNS or domain changes, and deleting data. When you stop, stage everything so the owner only has to confirm or paste one thing.
- **If a permission check blocks you,** say so in one line and give the shortest exact step to finish it. Don't look for a workaround.
- **Show, don't link.** When there's something to look at (a dev server, a Vercel preview or production deploy, a changed page, a dashboard), open it in a browser tab yourself, and after a UI change share a screenshot of the result.

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
- The merge policy and the reviewer themselves (`CLAUDE.md`, `.claude/**`), even
  though they are Markdown
- Anything outside the low-risk surfaces above

The reviewer (`.claude/agents/pr-reviewer.md`) is the source of truth for how this policy
is enforced. Tighten this block whenever something slips through. The workflow also
checks the changed-file list against the low-risk surfaces itself, and downgrades an
APPROVE-LOWRISK to ESCALATE if any file falls outside them; keep that list in
`.github/workflows/factory.yml` in step with this block.

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
- Never use em dashes. Not in chat, not in code, comments, UI copy,
  commit messages, or anything committed. Use commas, colons,
  parentheses, or a full stop instead.

## Design and UI work
Any product or feature change with a visual surface: present exactly three
options (A, B, C), one-line rationale each. Render them, never describe
them in prose. Build each as a working preview and open all three side by
side in a browser. `/design-shotgun` does this end to end.
Stop and wait for a choice before building anything further.

## Git workflow
- Never commit to `main`. Branch as `claude/<description>`.
- One PR per logical change, no mixing chores into feature branches.
- Delete the branch after merge.
<!-- END STANDARD -->
