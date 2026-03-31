#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERCEL_TOKEN="${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
PROJECT_JSON="${PROJECT_JSON:-.vercel/project.json}"
LOG_FILE="${LOG_FILE:-${TMPDIR:-/tmp}/chatbox-vercel-deploy.log}"

if [ ! -f "$PROJECT_JSON" ]; then
  echo "Missing Vercel project link file: $PROJECT_JSON" >&2
  exit 1
fi

if [ -z "${VERCEL_ORG_ID:-}" ]; then
  export VERCEL_ORG_ID
  VERCEL_ORG_ID="$(node -p "require('./${PROJECT_JSON}').orgId")"
fi

if [ -z "${VERCEL_PROJECT_ID:-}" ]; then
  export VERCEL_PROJECT_ID
  VERCEL_PROJECT_ID="$(node -p "require('./${PROJECT_JSON}').projectId")"
fi

vercel pull --yes --environment=production --token="$VERCEL_TOKEN" >/dev/null

pnpm build:web >&2

DEPLOY_ARGS=(deploy --prod --yes --token="$VERCEL_TOKEN")

if [ -n "${GITHUB_SHA:-}" ]; then
  DEPLOY_ARGS+=(
    --build-env "GITHUB_SHA=$GITHUB_SHA"
    --meta "githubCommitSha=$GITHUB_SHA"
  )
fi

: >"$LOG_FILE"

DEPLOYMENT_OUTPUT="$(
  vercel "${DEPLOY_ARGS[@]}" 2> >(tee "$LOG_FILE" >&2)
)"

DEPLOYMENT_URL="$(
  printf '%s\n' "$DEPLOYMENT_OUTPUT" | awk 'NF { url=$0 } END { print url }'
)"

if [ -z "$DEPLOYMENT_URL" ]; then
  echo "Could not determine deployment URL from Vercel stdout" >&2
  exit 1
fi

if ! printf '%s\n' "$DEPLOYMENT_URL" | grep -Eq '^https://[^[:space:]]+\.vercel\.app/?$'; then
  echo "Unexpected deployment URL from Vercel stdout: $DEPLOYMENT_URL" >&2
  exit 1
fi

printf '%s\n' "$DEPLOYMENT_URL"
