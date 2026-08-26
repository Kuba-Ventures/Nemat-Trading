#!/usr/bin/env bash
#
# Sets up the official Google Ads MCP server (googleads/google-ads-mcp) for the
# Claude clients that run on this machine: Claude Desktop, Claude Code CLI, and
# Cursor. Detects which are installed and configures each one you pick.
#
# IMPORTANT: this configures LOCAL clients only. claude.ai in a browser and
# Claude mobile cannot reach a server running on your machine. Covering those
# needs the Cloud Run deployment, see docs/google-ads-mcp.md.
#
# Run this on your own Mac, NOT in Google Cloud Shell. Cloud Shell is a
# throwaway VM inside Google's cloud, and nothing installed there is visible to
# Claude.
#
# Usage:
#   ./scripts/setup-google-ads-mcp.sh
#
# Non-interactive:
#   GOOGLE_ADS_DEVELOPER_TOKEN=xxx GOOGLE_PROJECT_ID=my-proj \
#     GOOGLE_ADS_MCP_TARGETS=desktop,cli ./scripts/setup-google-ads-mcp.sh
#
# Nothing here writes secrets into the repo. Credentials go to each client's
# local config file and to gcloud's ADC file.

set -euo pipefail

SERVER_NAME="google-ads-mcp"
SERVER_SPEC="git+https://github.com/googleads/google-ads-mcp.git"
ADS_SCOPE="https://www.googleapis.com/auth/adwords"
CLOUD_SCOPE="https://www.googleapis.com/auth/cloud-platform"

info()  { printf '\033[0;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[0;32m  ok\033[0m %s\n' "$*"; }
warn()  { printf '\033[0;33m  !!\033[0m %s\n' "$*"; }
die()   { printf '\033[0;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 0. Guard against the wrong machine
# ---------------------------------------------------------------------------
if [ -n "${CLOUD_SHELL:-}" ] || [ -n "${DEVSHELL_PROJECT_ID:-}" ]; then
  die "This looks like Google Cloud Shell. Run this on the machine where Claude
       runs (your own Mac), not in Cloud Shell. A server installed here cannot
       be reached by Claude. See docs/google-ads-mcp.md."
fi

# ---------------------------------------------------------------------------
# 1. Client detection
# ---------------------------------------------------------------------------
case "$(uname -s)" in
  Darwin) DESKTOP_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json" ;;
  Linux)  DESKTOP_CONFIG="$HOME/.config/Claude/claude_desktop_config.json" ;;
  *)      DESKTOP_CONFIG="" ;;
esac
CURSOR_CONFIG="$HOME/.cursor/mcp.json"

has_desktop() { [ -n "$DESKTOP_CONFIG" ] && [ -d "$(dirname "$DESKTOP_CONFIG")" ]; }
has_cli()     { command -v claude >/dev/null 2>&1; }
has_cursor()  { [ -d "$HOME/.cursor" ]; }

info "Detecting Claude clients on this machine"
DETECTED=()
has_desktop && { DETECTED+=("desktop"); ok "Claude Desktop"; }
has_cli     && { DETECTED+=("cli");     ok "Claude Code CLI"; }
has_cursor  && { DETECTED+=("cursor");  ok "Cursor"; }

[ ${#DETECTED[@]} -gt 0 ] \
  || die "No local Claude client found. Install Claude Desktop or the Claude Code CLI first."

if [ -n "${GOOGLE_ADS_MCP_TARGETS:-}" ]; then
  IFS=',' read -r -a TARGETS <<< "$GOOGLE_ADS_MCP_TARGETS"
else
  TARGETS=("${DETECTED[@]}")
fi
info "Will configure: ${TARGETS[*]}"

# ---------------------------------------------------------------------------
# 2. Prerequisites
# ---------------------------------------------------------------------------
info "Checking prerequisites"

command -v python3 >/dev/null 2>&1 || die "python3 not found. The server requires Python >= 3.10."
PY_OK=$(python3 -c 'import sys; print(1 if sys.version_info >= (3, 10) else 0)')
[ "$PY_OK" = "1" ] || die "Python >= 3.10 required, found $(python3 -V 2>&1)."
ok "python3 $(python3 -V 2>&1 | cut -d' ' -f2)"

if ! command -v pipx >/dev/null 2>&1; then
  warn "pipx not found, installing it"
  python3 -m pip install --user pipx
  python3 -m pipx ensurepath
  command -v pipx >/dev/null 2>&1 || die "pipx installed but not on PATH. Open a new shell and re-run."
fi
PIPX_BIN="$(command -v pipx)"
ok "pipx at $PIPX_BIN"

command -v gcloud >/dev/null 2>&1 \
  || die "gcloud not found. Install the Google Cloud CLI on this Mac: https://cloud.google.com/sdk/docs/install"
ok "gcloud present"

# ---------------------------------------------------------------------------
# 3. Collect configuration
# ---------------------------------------------------------------------------
info "Collecting configuration"

prompt_for() {
  local var="$1" label="$2" secret="${3:-}" current value
  current="${!var:-}"
  if [ -n "$current" ]; then ok "$label taken from environment"; return; fi
  if [ ! -t 0 ]; then die "$var is not set and this shell is not interactive. Export it and re-run."; fi
  if [ -n "$secret" ]; then read -r -s -p "  $label: " value; echo
  else read -r -p "  $label: " value; fi
  [ -n "$value" ] || die "$label is required."
  printf -v "$var" '%s' "$value"
  export "${var?}"
}

prompt_for GOOGLE_ADS_DEVELOPER_TOKEN "Google Ads developer token" secret
prompt_for GOOGLE_PROJECT_ID "Google Cloud project ID"

if [ -z "${GOOGLE_ADS_LOGIN_CUSTOMER_ID:-}" ] && [ -t 0 ]; then
  read -r -p "  Manager (MCC) customer ID, digits only, blank if none: " GOOGLE_ADS_LOGIN_CUSTOMER_ID || true
fi
# Google Ads rejects the dashed form, strip them defensively.
GOOGLE_ADS_LOGIN_CUSTOMER_ID="${GOOGLE_ADS_LOGIN_CUSTOMER_ID:-}"
GOOGLE_ADS_LOGIN_CUSTOMER_ID="${GOOGLE_ADS_LOGIN_CUSTOMER_ID//-/}"

# ---------------------------------------------------------------------------
# 4. Application Default Credentials
# ---------------------------------------------------------------------------
info "Setting up Application Default Credentials"

ADC_PATH="${GOOGLE_APPLICATION_CREDENTIALS:-$HOME/.config/gcloud/application_default_credentials.json}"

if [ -f "$ADC_PATH" ] && grep -q 'adwords' "$ADC_PATH" 2>/dev/null; then
  ok "ADC already present with the adwords scope"
else
  [ -f "$ADC_PATH" ] && warn "ADC exists but lacks the adwords scope, re-running login"
  info "A browser window will open. Approve access for the Google account that can see your Ads data."
  gcloud auth application-default login --scopes="${ADS_SCOPE},${CLOUD_SCOPE}"
fi
[ -f "$ADC_PATH" ] || die "Expected ADC file at $ADC_PATH but it is missing."
ok "credentials at $ADC_PATH"

gcloud services enable googleads.googleapis.com --project="$GOOGLE_PROJECT_ID" 2>/dev/null \
  && ok "Google Ads API enabled on $GOOGLE_PROJECT_ID" \
  || warn "Could not auto-enable the Google Ads API. Enable it at https://console.cloud.google.com/apis/library/googleads.googleapis.com?project=$GOOGLE_PROJECT_ID"

# ---------------------------------------------------------------------------
# 5. Configure each client
# ---------------------------------------------------------------------------

# Merges the server entry into a JSON config file, preserving everything else.
# Backs the file up first. Usage: merge_json_config <path>
merge_json_config() {
  local path="$1" dir
  dir="$(dirname "$path")"
  mkdir -p "$dir"
  [ -f "$path" ] || echo '{}' > "$path"
  cp "$path" "$path.bak.$(date +%Y%m%d%H%M%S)"

  CONFIG_PATH="$path" \
  MCP_SERVER_NAME="$SERVER_NAME" \
  MCP_PIPX_BIN="$PIPX_BIN" \
  MCP_SERVER_SPEC="$SERVER_SPEC" \
  MCP_ADC_PATH="$ADC_PATH" \
  python3 <<'PY'
import json, os, sys

path = os.environ["CONFIG_PATH"]
with open(path) as fh:
    try:
        config = json.load(fh)
    except json.JSONDecodeError:
        sys.exit(f"{path} is not valid JSON. Fix or move it, then re-run.")

env = {
    "GOOGLE_APPLICATION_CREDENTIALS": os.environ["MCP_ADC_PATH"],
    "GOOGLE_PROJECT_ID": os.environ["GOOGLE_PROJECT_ID"],
    "GOOGLE_CLOUD_PROJECT": os.environ["GOOGLE_PROJECT_ID"],
    "GOOGLE_ADS_DEVELOPER_TOKEN": os.environ["GOOGLE_ADS_DEVELOPER_TOKEN"],
}
login_cid = os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID", "")
if login_cid:
    env["GOOGLE_ADS_LOGIN_CUSTOMER_ID"] = login_cid

config.setdefault("mcpServers", {})[os.environ["MCP_SERVER_NAME"]] = {
    # Absolute path: GUI apps do not inherit the shell PATH, so a bare "pipx"
    # resolves for the CLI but fails silently under Claude Desktop.
    "command": os.environ["MCP_PIPX_BIN"],
    "args": ["run", "--spec", os.environ["MCP_SERVER_SPEC"], "google-ads-mcp"],
    "env": env,
}

with open(path, "w") as fh:
    json.dump(config, fh, indent=2)
    fh.write("\n")
PY
  chmod 600 "$path"
}

for target in "${TARGETS[@]}"; do
  case "$target" in
    desktop)
      info "Configuring Claude Desktop"
      [ -n "$DESKTOP_CONFIG" ] || { warn "Unsupported OS for Claude Desktop, skipping"; continue; }
      merge_json_config "$DESKTOP_CONFIG"
      ok "wrote $DESKTOP_CONFIG"
      warn "Quit Claude Desktop completely (Cmd+Q, not just the window) and reopen it."
      ;;
    cli)
      info "Configuring Claude Code CLI (user scope)"
      has_cli || { warn "claude CLI not found, skipping"; continue; }
      claude mcp remove "$SERVER_NAME" --scope user >/dev/null 2>&1 || true
      ENV_ARGS=(
        --env "GOOGLE_APPLICATION_CREDENTIALS=$ADC_PATH"
        --env "GOOGLE_PROJECT_ID=$GOOGLE_PROJECT_ID"
        --env "GOOGLE_CLOUD_PROJECT=$GOOGLE_PROJECT_ID"
        --env "GOOGLE_ADS_DEVELOPER_TOKEN=$GOOGLE_ADS_DEVELOPER_TOKEN"
      )
      [ -n "$GOOGLE_ADS_LOGIN_CUSTOMER_ID" ] \
        && ENV_ARGS+=( --env "GOOGLE_ADS_LOGIN_CUSTOMER_ID=$GOOGLE_ADS_LOGIN_CUSTOMER_ID" )
      claude mcp add "$SERVER_NAME" --scope user "${ENV_ARGS[@]}" \
        -- "$PIPX_BIN" run --spec "$SERVER_SPEC" google-ads-mcp
      ok "registered at user scope, available in every local project"
      ;;
    cursor)
      info "Configuring Cursor"
      merge_json_config "$CURSOR_CONFIG"
      ok "wrote $CURSOR_CONFIG"
      warn "Restart Cursor to pick it up."
      ;;
    *)
      warn "Unknown target '$target', skipping"
      ;;
  esac
done

# ---------------------------------------------------------------------------
# 6. Done
# ---------------------------------------------------------------------------
cat <<'DONE'

Setup complete.

First call is slow: pipx downloads the server package on first run.

Try it:
  "List my accessible Google Ads customers"
  "Show me spend and conversions by campaign for the last 30 days"

Tools exposed (all read-only, no writes to campaigns or spend):
  list_accessible_customers   accounts you can reach
  search                      GAQL queries for reporting
  get_resource_metadata       valid fields per resource

NOT covered by this setup: claude.ai in a browser, and Claude mobile. Those
cannot reach a server on your machine. See docs/google-ads-mcp.md for the
Cloud Run option that does cover them.

To remove:
  Claude Desktop / Cursor: delete the "google-ads-mcp" entry from the config
  Claude Code CLI:         claude mcp remove google-ads-mcp --scope user
DONE
