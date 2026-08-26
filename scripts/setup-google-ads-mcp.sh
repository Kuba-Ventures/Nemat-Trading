#!/usr/bin/env bash
#
# Sets up the official Google Ads MCP server (googleads/google-ads-mcp) for
# Claude Code at user scope, so it is available in every local project.
#
# Read-only: the server exposes GAQL search, resource metadata lookup, and
# accessible-customer listing. It cannot mutate campaigns or spend.
#
# Usage:
#   ./scripts/setup-google-ads-mcp.sh
#
# Non-interactive (values may also be exported ahead of time):
#   GOOGLE_ADS_DEVELOPER_TOKEN=xxx GOOGLE_PROJECT_ID=my-proj \
#     ./scripts/setup-google-ads-mcp.sh
#
# Nothing here writes secrets into the repo. Credentials go to your local
# Claude config (~/.claude.json) and to gcloud's ADC file.

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
# 1. Prerequisites
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
ok "pipx $(pipx --version 2>/dev/null || echo present)"

command -v gcloud >/dev/null 2>&1 \
  || die "gcloud not found. Install the Google Cloud CLI: https://cloud.google.com/sdk/docs/install"
ok "gcloud present"

command -v claude >/dev/null 2>&1 \
  || die "claude CLI not found. This script registers the server via 'claude mcp add'."
ok "claude CLI present"

# ---------------------------------------------------------------------------
# 2. Collect configuration
# ---------------------------------------------------------------------------
info "Collecting configuration"

prompt_for() {
  # prompt_for VAR_NAME "Human label" [secret]
  local var="$1" label="$2" secret="${3:-}" current value
  current="${!var:-}"
  if [ -n "$current" ]; then
    ok "$label taken from environment"
    return
  fi
  if [ ! -t 0 ]; then
    die "$var is not set and this shell is not interactive. Export it and re-run."
  fi
  if [ -n "$secret" ]; then
    read -r -s -p "  $label: " value; echo
  else
    read -r -p "  $label: " value
  fi
  [ -n "$value" ] || die "$label is required."
  printf -v "$var" '%s' "$value"
  export "${var?}"
}

prompt_for GOOGLE_ADS_DEVELOPER_TOKEN "Google Ads developer token" secret
prompt_for GOOGLE_PROJECT_ID "Google Cloud project ID"

# Only needed when the account is reached through a manager (MCC) account.
if [ -z "${GOOGLE_ADS_LOGIN_CUSTOMER_ID:-}" ] && [ -t 0 ]; then
  read -r -p "  Manager (MCC) customer ID, digits only, blank if none: " GOOGLE_ADS_LOGIN_CUSTOMER_ID || true
fi
GOOGLE_ADS_LOGIN_CUSTOMER_ID="${GOOGLE_ADS_LOGIN_CUSTOMER_ID:-}"
# Google Ads rejects the dashed form, strip them defensively.
GOOGLE_ADS_LOGIN_CUSTOMER_ID="${GOOGLE_ADS_LOGIN_CUSTOMER_ID//-/}"

# ---------------------------------------------------------------------------
# 3. Application Default Credentials
# ---------------------------------------------------------------------------
info "Setting up Application Default Credentials"

ADC_PATH="${GOOGLE_APPLICATION_CREDENTIALS:-$HOME/.config/gcloud/application_default_credentials.json}"

if [ -f "$ADC_PATH" ] && grep -q 'adwords' "$ADC_PATH" 2>/dev/null; then
  ok "ADC already present with the adwords scope at $ADC_PATH"
else
  if [ -f "$ADC_PATH" ]; then
    warn "ADC exists but lacks the adwords scope, re-running login"
  fi
  info "A browser window will open. Approve access for the Google account that can see your Ads data."
  gcloud auth application-default login --scopes="${ADS_SCOPE},${CLOUD_SCOPE}"
fi

[ -f "$ADC_PATH" ] || die "Expected ADC file at $ADC_PATH but it is missing."
ok "credentials at $ADC_PATH"

gcloud services enable googleads.googleapis.com --project="$GOOGLE_PROJECT_ID" 2>/dev/null \
  && ok "Google Ads API enabled on $GOOGLE_PROJECT_ID" \
  || warn "Could not auto-enable the Google Ads API. Enable it manually: https://console.cloud.google.com/apis/library/googleads.googleapis.com?project=$GOOGLE_PROJECT_ID"

# ---------------------------------------------------------------------------
# 4. Register with Claude Code at user scope
# ---------------------------------------------------------------------------
info "Registering the MCP server with Claude Code (user scope)"

if claude mcp get "$SERVER_NAME" >/dev/null 2>&1; then
  warn "$SERVER_NAME already registered, replacing it"
  claude mcp remove "$SERVER_NAME" --scope user >/dev/null 2>&1 || true
fi

ENV_ARGS=(
  --env "GOOGLE_APPLICATION_CREDENTIALS=$ADC_PATH"
  --env "GOOGLE_PROJECT_ID=$GOOGLE_PROJECT_ID"
  --env "GOOGLE_CLOUD_PROJECT=$GOOGLE_PROJECT_ID"
  --env "GOOGLE_ADS_DEVELOPER_TOKEN=$GOOGLE_ADS_DEVELOPER_TOKEN"
)
if [ -n "$GOOGLE_ADS_LOGIN_CUSTOMER_ID" ]; then
  ENV_ARGS+=( --env "GOOGLE_ADS_LOGIN_CUSTOMER_ID=$GOOGLE_ADS_LOGIN_CUSTOMER_ID" )
fi

claude mcp add "$SERVER_NAME" \
  --scope user \
  "${ENV_ARGS[@]}" \
  -- pipx run --spec "$SERVER_SPEC" google-ads-mcp

ok "registered at user scope, available in every local project"

# ---------------------------------------------------------------------------
# 5. Verify
# ---------------------------------------------------------------------------
info "Verifying"
info "First run downloads the package via pipx, so allow up to a minute."

if claude mcp list 2>&1 | grep -q "$SERVER_NAME"; then
  ok "$SERVER_NAME appears in 'claude mcp list'"
else
  warn "Not visible in 'claude mcp list' yet. Check with: claude mcp get $SERVER_NAME"
fi

cat <<'DONE'

Setup complete.

Try it in any project:
  "List my accessible Google Ads customers"
  "Show me spend and conversions by campaign for the last 30 days"

Tools exposed (all read-only):
  list_accessible_customers   accounts you can reach
  search                      GAQL queries for reporting
  get_resource_metadata       valid fields per resource

To remove:  claude mcp remove google-ads-mcp --scope user
DONE
