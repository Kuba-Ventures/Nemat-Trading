# Google Ads MCP setup

Official Google server: [googleads/google-ads-mcp](https://github.com/googleads/google-ads-mcp)
(Apache-2.0, published under Google's `googleads` org).

## Run this on your own Mac, not in Cloud Shell

Google Cloud Shell is a throwaway Linux VM inside Google's cloud. It is not your
machine. An MCP server has to run on the same machine as the Claude client that
uses it, so anything installed in Cloud Shell is invisible to Claude, and the VM
wipes itself when idle anyway.

The one thing Cloud Shell is genuinely useful for here is enabling the API, which
is a cloud-side action:

```bash
gcloud services enable googleads.googleapis.com --project=YOUR_PROJECT_ID
```

Everything else happens on your Mac. The script refuses to run in Cloud Shell.

## Which Claude surfaces this covers

A locally installed MCP server is reachable only by Claude clients running on the
same machine.

| Surface | Covered by `setup-google-ads-mcp.sh`? |
| --- | --- |
| Claude Desktop app | Yes |
| Claude Code CLI | Yes, at user scope, so every local project |
| Cursor | Yes |
| **claude.ai in a browser** | **No** |
| **Claude mobile** | **No** |
| Claude Code on the web | No |

The browser and mobile cannot reach your machine. Covering them needs the Cloud
Run deployment described at the bottom of this doc.

## TL;DR

On your Mac, in Terminal:

```bash
./scripts/setup-google-ads-mcp.sh
```

It detects which Claude clients you have, then configures the ones you pick.
Budget about 10 minutes, assuming you already have a developer token.

## What you need first

| Item | Where to get it | Time |
| --- | --- | --- |
| Google Ads **developer token** | Google Ads UI, Tools, API Center | Instant if you have one, otherwise a few days for approval |
| **Google Cloud project** with the Google Ads API enabled | [console.cloud.google.com](https://console.cloud.google.com) | ~2 min |
| **gcloud CLI on your Mac** | [install guide](https://cloud.google.com/sdk/docs/install) | ~5 min |
| **Python 3.10+** and **pipx** | Script installs pipx if missing | ~1 min |
| Manager (MCC) customer ID | Only if you reach the account through a manager account | Optional |

### On the developer token

Access levels matter:

- **Test access** reaches test accounts only. Fine for wiring things up, useless for real reporting.
- **Basic access** is what you want. Apply in the API Center. Approval is manual and usually takes a few business days.

Apply early. It is the only step you cannot rush.

## What the server can and cannot do

**Read-only.** All three tools are annotated `readOnlyHint=True` in the source.
There is no way to change a bid, budget, or campaign state through it.

| Tool | Purpose |
| --- | --- |
| `list_accessible_customers` | Ad accounts the authenticated user can reach |
| `search` | GAQL queries: spend, conversions, search terms, ad group performance |
| `get_resource_metadata` | Valid fields per resource, which stops the model inventing field names |

It also exposes reference resources: the API discovery document, metrics and
segments references, and release notes.

If you later need writes (pausing a campaign, pushing a customer list), that is a
separate path through the Zapier connector, which is already connected on this
profile.

## Verifying it works

**Claude Desktop:** quit completely with Cmd+Q, not just closing the window, then
reopen. The server appears under the tools icon in the composer.

**Claude Code CLI:**

```bash
claude mcp list
claude mcp get google-ads-mcp
```

Then ask, in any client:

> List my accessible Google Ads customers

The first call is slow, since pipx downloads the package on first run.

## Troubleshooting

**Nothing appears in Claude Desktop**
GUI apps on macOS do not inherit your shell `PATH`, so a bare `pipx` in the config
fails silently. The script writes the absolute path to `pipx` for this reason. If
you hand-edited the config, check that `command` is a full path such as
`/opt/homebrew/bin/pipx`. Also confirm you fully quit and reopened the app.

**`GOOGLE_ADS_DEVELOPER_TOKEN environment variable not set`**
The env block did not reach the server. Check the `env` object in the client's config.

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

## Covering the browser and mobile

Everything above is local. To use Google Ads data from claude.ai in a browser or
from Claude mobile, the server has to run somewhere both can reach, which means
deploying it and adding it as a custom connector.

Upstream ships a `Dockerfile` and documents a Cloud Run deployment behind FastMCP's
OAuth proxy. The extra pieces are:

- A Cloud Run service built from the upstream `Dockerfile`
- An OAuth client, supplying `GOOGLE_ADS_MCP_OAUTH_CLIENT_ID` and `GOOGLE_ADS_MCP_OAUTH_CLIENT_SECRET`
- `GOOGLE_ADS_MCP_BASE_URL`, `GOOGLE_ADS_MCP_JWT_SIGNING_KEY`, and a token store (`GOOGLE_ADS_MCP_STORAGE_TYPE=firestore`)
- Adding the resulting HTTPS endpoint as a custom connector in claude.ai settings

Roughly 1 to 2 hours, and it covers every surface at once including the local ones.
Not yet built in this repo.

Note on the Firestore backend: token entries are not auto-expired, so a long-running
deployment needs periodic cleanup.

## Removing it

Claude Desktop and Cursor: delete the `google-ads-mcp` entry from the config file.
The script leaves a timestamped `.bak` next to each file it edits.

Claude Code CLI:

```bash
claude mcp remove google-ads-mcp --scope user
```

## Security notes

- No credentials are stored in this repo. The developer token goes into each
  client's local config, and OAuth credentials into gcloud's ADC file. The script
  chmods the configs it writes to `600`.
- Google's own README is blunt about the tradeoff: the server exposes your ads data
  to whatever model you connect it to. Read-only limits the blast radius to
  disclosure, not spend.
