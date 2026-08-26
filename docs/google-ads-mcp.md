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

| Surface | `setup-google-ads-mcp.sh` (local) | `deploy-google-ads-mcp-cloudrun.sh` (hosted) |
| --- | --- | --- |
| Claude Desktop app | Yes | Yes |
| Claude Code CLI | Yes, at user scope | Yes |
| Cursor | Yes | Yes |
| claude.ai in a browser | No | Yes |
| Claude mobile | No | Yes |
| Claude Code on the web | No | Yes |

The local install is faster to stand up and keeps everything on your machine. The
Cloud Run deployment covers every surface, including the browser, at the cost of
running a service. See [Covering the browser and mobile](#covering-the-browser-and-mobile).

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
| Google Ads **developer token** | [ads.google.com/aw/apicenter](https://ads.google.com/aw/apicenter), manager account required | Instant if you have one, otherwise a few days for approval |
| **Google Cloud project** with the Google Ads API enabled | [console.cloud.google.com](https://console.cloud.google.com) | ~2 min |
| **gcloud CLI on your Mac** | [macOS install guide](https://cloud.google.com/sdk/docs/install-sdk#mac), or `brew install --cask google-cloud-sdk` | ~5 min |
| **Python 3.10+** and **pipx** | Script installs pipx if missing | ~1 min |
| Manager (MCC) customer ID | Only if you reach the account through a manager account | Optional |

### On the developer token

Apply here: **<https://ads.google.com/aw/apicenter>**

Two things trip people up.

**It must be a manager (MCC) account.** The API Center only exists inside a
Google Ads manager account. If you sign in with a regular Ads account the page
is simply not there, which reads like a broken link rather than a missing
prerequisite.

Check whether you already have one before creating anything: open the account
picker (your avatar, top right of the Google Ads UI) and look for an account
tagged **Manager**. Switch into that account first, then open the API Center. If
there is no manager account, create one at
<https://ads.google.com/home/tools/manager-accounts/>.

An account marked "(Setup in progress)" in that list has not finished onboarding.
If the API Center is missing on a manager account showing that tag, complete its
setup (billing details are the usual gap) and try again.

**Access levels matter:**

- **Test access** reaches test accounts only. Fine for wiring things up, useless for real reporting.
- **Basic access** is what you want. Apply in the API Center. Approval is manual and usually takes a few business days.

A newly issued token starts on Test access. Against a real account it returns
`DEVELOPER_TOKEN_NOT_APPROVED`, so complete the Basic access application while you
are in the API Center rather than just copying the token and leaving.

Apply early. It is the only step you cannot rush.

### The token does not have to come from the account you want to read

This is the piece that causes the most confusion. A developer token is an
**application** credential: it identifies your API client, not the accounts it may
touch. Which accounts you can actually read is decided by the Google account you
sign in with during OAuth.

So a token issued by manager account A can query account B, as long as the Google
account you authorize with can already see B in its Google Ads account list. B does
not need to sit under A.

That also settles what to put in `GOOGLE_ADS_LOGIN_CUSTOMER_ID`:

| Your access to the account | Value |
| --- | --- |
| You are a user on the account directly | Leave blank |
| You reach it only through a manager account | The manager's customer ID, digits only |

Setting it when it does not apply causes `USER_PERMISSION_DENIED`, so leave it blank
if you are unsure and add it only if the error tells you to.

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

Everything above is local, and a local server is unreachable from claude.ai in a
browser or from Claude mobile. To cover those, the server has to run somewhere
both can reach:

```bash
./scripts/deploy-google-ads-mcp-cloudrun.sh
```

This deploys the same upstream server to Cloud Run behind FastMCP's OAuth proxy,
then gives you an HTTPS endpoint to add as a custom connector in claude.ai. It
covers every surface at once, local clients included, since they can point at the
same endpoint instead of running their own copy.

Budget 1 to 2 hours the first time, mostly waiting on builds.

### How it runs

The OAuth redirect URI depends on the URL Cloud Run assigns, so the script works
in two phases and is resumable.

1. **Phase 1** enables the APIs, creates a Firestore database for the token store,
   builds and pushes the image, deploys the service, and prints the URL.
2. **You** create an OAuth client (the one step that cannot be scripted) with the
   redirect URI it prints, which is `https://YOUR-SERVICE-URL/auth/callback`.
   That path is FastMCP's default and upstream does not override it.
3. **Phase 2** attaches the credentials and redeploys.

Re-running the script after Phase 1 detects the existing service and resumes.
You can also skip the prompt by exporting `GOOGLE_ADS_MCP_OAUTH_CLIENT_ID` and
`GOOGLE_ADS_MCP_OAUTH_CLIENT_SECRET`.

### Two things the script handles that the upstream README leaves to you

- **The Firestore extra.** The stock `Dockerfile` runs `uv pip install --system .`,
  which omits the Firestore token store. Setting
  `GOOGLE_ADS_MCP_STORAGE_TYPE=firestore` against that image fails at startup. The
  script patches the install to `.[firestore]` before building.
- **JWT signing key reuse.** Redeploying with a fresh key silently invalidates
  every session token already issued. The script reads the existing key off the
  running service and reuses it.

### Adding it to claude.ai

1. Settings, Connectors, Add custom connector
2. Paste the `/mcp` endpoint the script prints
3. Sign in with the Google account that can see your Ads data

### Security shape

The service deploys with `--allow-unauthenticated`, which is required: claude.ai
reaches the endpoint without a Google IAM identity. The endpoint is not open,
though. Access control is the server's own OAuth proxy, which requires a Google
login carrying the `adwords` scope before any tool call runs, and the tools are
read-only regardless.

The developer token and OAuth client secret are stored as Cloud Run environment
variables, matching upstream's documented setup. Anyone with console access to the
project can read them. Moving them to Secret Manager is a reasonable hardening
step if the project gains other collaborators.

### Housekeeping

Firestore token entries are never expired upstream: the store filters expired
entries on read but never deletes them, and `expires_at` is written as a string so
a Firestore TTL policy cannot collect them either. Plan a periodic cleanup job for
a long-lived deployment.

Tear down:

```bash
gcloud run services delete google-ads-mcp --region=us-central1 --project=YOUR_PROJECT_ID
```

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
