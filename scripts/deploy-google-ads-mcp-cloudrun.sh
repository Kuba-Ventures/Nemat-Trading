#!/usr/bin/env bash
#
# Deploys the official Google Ads MCP server (googleads/google-ads-mcp) to
# Google Cloud Run, so it can be added to claude.ai as a custom connector and
# used from the browser and from Claude mobile.
#
# A local install (scripts/setup-google-ads-mcp.sh) only reaches Claude clients
# running on your own machine. This one reaches everything, local clients
# included, since they can point at the same HTTPS endpoint.
#
# Runs in two phases, because the OAuth redirect URI depends on the service URL
# that Cloud Run assigns:
#
#   Phase 1  build the image, create Firestore, deploy, print the service URL
#   -- you create an OAuth client with that URL --
#   Phase 2  attach the OAuth credentials and redeploy
#
# The script is resumable. Re-run it after Phase 1 and it detects the existing
# service and goes straight to Phase 2.
#
# Usage:
#   ./scripts/deploy-google-ads-mcp-cloudrun.sh
#
# Overridable:
#   GOOGLE_PROJECT_ID, REGION (default us-central1),
#   FIRESTORE_LOCATION (default nam5), SERVICE_NAME (default google-ads-mcp)

set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-google-ads-mcp}"
REGION="${REGION:-us-central1}"
FIRESTORE_LOCATION="${FIRESTORE_LOCATION:-nam5}"
AR_REPO="mcp-servers"
UPSTREAM="https://github.com/googleads/google-ads-mcp.git"

info()  { printf '\033[0;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[0;32m  ok\033[0m %s\n' "$*"; }
warn()  { printf '\033[0;33m  !!\033[0m %s\n' "$*"; }
die()   { printf '\033[0;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------
info "Checking prerequisites"

command -v gcloud >/dev/null 2>&1 \
  || die "gcloud not found: https://cloud.google.com/sdk/docs/install"
command -v git >/dev/null 2>&1 || die "git not found."
command -v openssl >/dev/null 2>&1 || die "openssl not found."
ok "gcloud, git, openssl present"

GOOGLE_PROJECT_ID="${GOOGLE_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
[ -n "$GOOGLE_PROJECT_ID" ] && [ "$GOOGLE_PROJECT_ID" != "(unset)" ] \
  || die "No project set. Run: gcloud config set project YOUR_PROJECT_ID"
ok "project $GOOGLE_PROJECT_ID"

PROJECT_NUMBER="$(gcloud projects describe "$GOOGLE_PROJECT_ID" --format='value(projectNumber)')"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

if [ -z "${GOOGLE_ADS_DEVELOPER_TOKEN:-}" ]; then
  [ -t 0 ] || die "GOOGLE_ADS_DEVELOPER_TOKEN not set and shell is not interactive."
  read -r -s -p "  Google Ads developer token: " GOOGLE_ADS_DEVELOPER_TOKEN; echo
fi
[ -n "$GOOGLE_ADS_DEVELOPER_TOKEN" ] || die "Developer token is required."

if [ -z "${GOOGLE_ADS_LOGIN_CUSTOMER_ID:-}" ] && [ -t 0 ]; then
  read -r -p "  Manager (MCC) customer ID, digits only, blank if none: " GOOGLE_ADS_LOGIN_CUSTOMER_ID || true
fi
GOOGLE_ADS_LOGIN_CUSTOMER_ID="${GOOGLE_ADS_LOGIN_CUSTOMER_ID:-}"
GOOGLE_ADS_LOGIN_CUSTOMER_ID="${GOOGLE_ADS_LOGIN_CUSTOMER_ID//-/}"

# ---------------------------------------------------------------------------
# Enable APIs
# ---------------------------------------------------------------------------
info "Enabling required APIs (idempotent, may take a minute)"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  googleads.googleapis.com \
  --project="$GOOGLE_PROJECT_ID"
ok "APIs enabled"

# ---------------------------------------------------------------------------
# Firestore (token store)
# ---------------------------------------------------------------------------
info "Ensuring a Firestore database exists"
if gcloud firestore databases list --project="$GOOGLE_PROJECT_ID" --format='value(name)' 2>/dev/null | grep -q .; then
  ok "Firestore database already present"
else
  gcloud firestore databases create \
    --location="$FIRESTORE_LOCATION" \
    --project="$GOOGLE_PROJECT_ID"
  ok "Firestore database created in $FIRESTORE_LOCATION"
fi

info "Granting the Cloud Run service account access to Firestore"
gcloud projects add-iam-policy-binding "$GOOGLE_PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/datastore.user" \
  --condition=None >/dev/null
ok "roles/datastore.user granted to $RUNTIME_SA"

# ---------------------------------------------------------------------------
# Build the image
# ---------------------------------------------------------------------------
info "Building the container image"

WORKDIR="$(mktemp -d)"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

git clone --depth 1 "$UPSTREAM" "$WORKDIR/src" >/dev/null 2>&1
ok "cloned upstream at $(git -C "$WORKDIR/src" rev-parse --short HEAD)"

# The stock Dockerfile installs the base package only. The Firestore token store
# lives behind an extra, and without it the server fails at startup once
# GOOGLE_ADS_MCP_STORAGE_TYPE=firestore is set.
if grep -q 'uv pip install --system \.$' "$WORKDIR/src/Dockerfile"; then
  sed -i.bak 's|uv pip install --system \.$|uv pip install --system ".[firestore]"|' "$WORKDIR/src/Dockerfile"
  rm -f "$WORKDIR/src/Dockerfile.bak"
  ok "patched Dockerfile to install the firestore extra"
else
  warn "Dockerfile install line not in the expected form, leaving it alone."
  warn "If the service crashes on startup, check that .[firestore] is installed."
fi

if ! gcloud artifacts repositories describe "$AR_REPO" \
      --location="$REGION" --project="$GOOGLE_PROJECT_ID" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$AR_REPO" \
    --repository-format=docker --location="$REGION" --project="$GOOGLE_PROJECT_ID"
  ok "created Artifact Registry repo $AR_REPO"
else
  ok "Artifact Registry repo $AR_REPO already exists"
fi

IMAGE="${REGION}-docker.pkg.dev/${GOOGLE_PROJECT_ID}/${AR_REPO}/${SERVICE_NAME}:latest"
info "Submitting build (a few minutes on first run)"
gcloud builds submit "$WORKDIR/src" --tag "$IMAGE" --project="$GOOGLE_PROJECT_ID"
ok "image pushed: $IMAGE"

# ---------------------------------------------------------------------------
# Phase 1: deploy to obtain the service URL
# ---------------------------------------------------------------------------
JWT_KEY="${GOOGLE_ADS_MCP_JWT_SIGNING_KEY:-}"
if [ -z "$JWT_KEY" ]; then
  EXISTING_KEY="$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" \
    --project="$GOOGLE_PROJECT_ID" \
    --format='value(spec.template.spec.containers[0].env.filter("name:GOOGLE_ADS_MCP_JWT_SIGNING_KEY").extract("value"))' 2>/dev/null || true)"
  # Reuse the existing key across redeploys: rotating it invalidates every
  # session token the proxy has already handed out.
  if [ -n "$EXISTING_KEY" ]; then
    JWT_KEY="$EXISTING_KEY"
    ok "reusing the existing JWT signing key"
  else
    JWT_KEY="$(openssl rand -base64 32)"
    ok "generated a new JWT signing key"
  fi
fi

base_env() {
  local out="GOOGLE_PROJECT_ID=${GOOGLE_PROJECT_ID}"
  out+=",GOOGLE_CLOUD_PROJECT=${GOOGLE_PROJECT_ID}"
  out+=",GOOGLE_ADS_DEVELOPER_TOKEN=${GOOGLE_ADS_DEVELOPER_TOKEN}"
  out+=",GOOGLE_ADS_MCP_JWT_SIGNING_KEY=${JWT_KEY}"
  out+=",GOOGLE_ADS_MCP_STORAGE_TYPE=firestore"
  out+=",FASTMCP_HOST=0.0.0.0"
  [ -n "$GOOGLE_ADS_LOGIN_CUSTOMER_ID" ] \
    && out+=",GOOGLE_ADS_LOGIN_CUSTOMER_ID=${GOOGLE_ADS_LOGIN_CUSTOMER_ID}"
  printf '%s' "$out"
}

info "Deploying to Cloud Run (phase 1)"
# --allow-unauthenticated is required: claude.ai reaches this endpoint without a
# Google IAM identity. Access control is the server's own OAuth proxy, which
# requires a Google login carrying the adwords scope.
gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --platform managed \
  --region "$REGION" \
  --project "$GOOGLE_PROJECT_ID" \
  --allow-unauthenticated \
  --set-env-vars="$(base_env)" \
  --quiet

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" \
  --region="$REGION" --project="$GOOGLE_PROJECT_ID" --format='value(status.url)')"
[ -n "$SERVICE_URL" ] || die "Could not read the Cloud Run service URL."
ok "service URL: $SERVICE_URL"

REDIRECT_URI="${SERVICE_URL}/auth/callback"
MCP_ENDPOINT="${SERVICE_URL}/mcp"

# ---------------------------------------------------------------------------
# Phase 2: OAuth credentials
# ---------------------------------------------------------------------------
CLIENT_ID="${GOOGLE_ADS_MCP_OAUTH_CLIENT_ID:-}"
CLIENT_SECRET="${GOOGLE_ADS_MCP_OAUTH_CLIENT_SECRET:-}"

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
  cat <<EOF

--------------------------------------------------------------------------
Phase 1 done. Now create an OAuth client, which cannot be scripted.

1. Open:
   https://console.cloud.google.com/apis/credentials?project=${GOOGLE_PROJECT_ID}

2. Create Credentials, OAuth client ID, type "Web application".

3. Under "Authorized redirect URIs" add exactly:
   ${REDIRECT_URI}

4. Copy the client ID and client secret, then paste them below.
   (Or press Ctrl-C and re-run this script later with
    GOOGLE_ADS_MCP_OAUTH_CLIENT_ID and GOOGLE_ADS_MCP_OAUTH_CLIENT_SECRET set.)
--------------------------------------------------------------------------

EOF
  [ -t 0 ] || die "OAuth credentials not set and shell is not interactive."
  read -r -p "  OAuth client ID: " CLIENT_ID
  read -r -s -p "  OAuth client secret: " CLIENT_SECRET; echo
fi

[ -n "$CLIENT_ID" ] && [ -n "$CLIENT_SECRET" ] || die "OAuth client ID and secret are required."

info "Redeploying with OAuth enabled (phase 2)"
FULL_ENV="$(base_env)"
FULL_ENV+=",GOOGLE_ADS_MCP_BASE_URL=${SERVICE_URL}"
FULL_ENV+=",GOOGLE_ADS_MCP_OAUTH_CLIENT_ID=${CLIENT_ID}"
FULL_ENV+=",GOOGLE_ADS_MCP_OAUTH_CLIENT_SECRET=${CLIENT_SECRET}"

gcloud run services update "$SERVICE_NAME" \
  --region="$REGION" \
  --project="$GOOGLE_PROJECT_ID" \
  --set-env-vars="$FULL_ENV" \
  --quiet
ok "OAuth enabled"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
cat <<EOF

Deployment complete.

MCP endpoint:
  ${MCP_ENDPOINT}

Add it to claude.ai:
  1. Settings, Connectors, Add custom connector
  2. Paste the endpoint above
  3. Sign in with the Google account that can see your Ads data

That covers the browser, mobile, and the desktop app at once.

Point local clients at it too (replacing the local stdio server):
  {"mcpServers": {"google-ads-mcp": {"httpUrl": "${MCP_ENDPOINT}"}}}

Housekeeping:
  - Firestore token entries are never auto-expired upstream. Plan a periodic
    cleanup for a long-lived deployment.
  - Redeploy after an upstream update:  ./scripts/deploy-google-ads-mcp-cloudrun.sh
  - Tear down:
      gcloud run services delete ${SERVICE_NAME} --region=${REGION} --project=${GOOGLE_PROJECT_ID}
EOF
