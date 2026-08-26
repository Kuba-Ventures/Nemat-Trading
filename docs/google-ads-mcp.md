# Google Ads MCP setup

Official Google server: [googleads/google-ads-mcp](https://github.com/googleads/google-ads-mcp)
(Apache-2.0, published under Google's `googleads` org).

Installs at **user scope**, so it is available in every local Claude Code project,
not just this repo.

## TL;DR

```bash
./scripts/setup-google-ads-mcp.sh
```

The script checks prerequisites, walks you through Google auth, and registers the
server. Budget about 10 minutes, assuming you already have a developer token.

## What you need before running it

| Item | Where to get it | Time |
| --- | --- | --- |
| Google Ads **developer token** | Google Ads UI, Tools, API Center | Instant if you have one, otherwise a few days for approval |
| **Google Cloud project** with the Google Ads API enabled | [console.cloud.google.com](https://console.cloud.google.com) | ~2 min |
| **gcloud CLI** | [install guide](https://cloud.google.com/sdk/docs/install) | ~5 min |
| **Python 3.10+** and **pipx** | Script installs pipx if missing | ~1 min |
| Manager (MCC) customer ID | Only if you reach the account through a manager account | Optional |

### On the developer token

Access levels matter:

- **Test access** reaches test accounts only. Fine for wiring things up, useless for real reporting.
- **Basic access** is what you want. Apply in the API Center. Approval is manual and usually takes a few business days.

Apply early. It is the only step you cannot rush.

## What the server can and cannot do

**Read-only.** All three tools are annotated `readOnlyHint=True` in the source. There
is no way to change a bid, budget, or campaign state through it.

| Tool | Purpose |
| --- | --- |
| `list_accessible_customers` | Ad accounts the authenticated user can reach |
| `search` | GAQL queries: spend, conversions, search terms, ad group performance |
| `get_resource_metadata` | Valid fields per resource, which stops the model inventing field names |

It also exposes reference resources: the API discovery document, metrics and segments
references, and release notes.

If you later need writes (pausing a campaign, pushing a customer list), that is a
separate path through the Zapier connector, which is already connected on this profile.

## Scope limits

User scope covers **every local Claude Code project on your machine**. It does not
cover:

- Claude on the web or mobile
- Claude Code web sessions (ephemeral containers, no access to your local credentials)

Covering those means deploying the server's Cloud Run variant behind its FastMCP OAuth
proxy and adding it as a custom connector. That is a bigger job, roughly 2 hours, and
worth doing only if you actually want Ads data from your phone.

## Verifying it works

```bash
claude mcp list          # google-ads-mcp should appear
claude mcp get google-ads-mcp
```

Then in any project:

> List my accessible Google Ads customers

> Show spend and conversions by campaign for the last 30 days

The first call is slow, since pipx downloads the package on first run.

## Troubleshooting

**`GOOGLE_ADS_DEVELOPER_TOKEN environment variable not set`**
The env block did not reach the server. Check `claude mcp get google-ads-mcp`.

**`PERMISSION_DENIED` or `DEVELOPER_TOKEN_NOT_APPROVED`**
Your token is still on test access, or the Google account you authorized with ADC
cannot see the account you are querying.

**`USER_PERMISSION_DENIED` on a specific customer ID**
You reach that account through a manager account. Re-run the script and supply the
manager (MCC) customer ID, digits only.

**Auth stopped working after a while**
ADC refresh tokens expire. Re-run:

```bash
gcloud auth application-default login \
  --scopes=https://www.googleapis.com/auth/adwords,https://www.googleapis.com/auth/cloud-platform
```

## Removing it

```bash
claude mcp remove google-ads-mcp --scope user
```

## Security notes

- No credentials are stored in this repo. The developer token goes into your local
  `~/.claude.json`, and OAuth credentials into gcloud's ADC file.
- Google's own README is blunt about the tradeoff: the server exposes your ads data to
  whatever model you connect it to. Read-only limits the blast radius to disclosure,
  not spend.
