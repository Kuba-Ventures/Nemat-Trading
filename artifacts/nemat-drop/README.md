# nemat-drop

The Nemat Trading storefront — a Vite + React single-page app for the product drop.
Deploys to Vercel; talks to the Express API in `artifacts/api-server` over HTTPS.

## Local development

```bash
pnpm install        # from the repo root
pnpm --filter @workspace/nemat-drop dev
```

Set `VITE_API_URL` to point at the API server (defaults to the deployed backend).

## Build

```bash
pnpm --filter @workspace/nemat-drop build
```

Output lands in `dist/`, which Vercel serves as a static site.
