#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DEPLOYMENT_URL="${1:?usage: verify-vercel-deployment.sh <deployment-url> [target-environment] [expected-commit-sha]}"
TARGET_ENVIRONMENT="${2:-production}"
EXPECTED_COMMIT_SHA="${3:-${GITHUB_SHA:-}}"
VERCEL_TOKEN="${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
INSPECT_TIMEOUT="${INSPECT_TIMEOUT:-10m}"
PROJECT_JSON="${PROJECT_JSON:-.vercel/project.json}"
TMP_HEALTHZ="$(mktemp)"

cleanup() {
  rm -f "$TMP_HEALTHZ"
}

trap cleanup EXIT

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

vercel inspect "$DEPLOYMENT_URL" --wait --timeout "$INSPECT_TIMEOUT" --token="$VERCEL_TOKEN"
vercel inspect "$DEPLOYMENT_URL" --logs --wait --timeout "$INSPECT_TIMEOUT" --token="$VERCEL_TOKEN"

if vercel curl /healthz.json --deployment "$DEPLOYMENT_URL" --token="$VERCEL_TOKEN" >"$TMP_HEALTHZ" 2>/dev/null; then
  :
else
  curl -fsSL "${DEPLOYMENT_URL%/}/healthz.json" >"$TMP_HEALTHZ"
fi

node --input-type=module - "$TMP_HEALTHZ" "$TARGET_ENVIRONMENT" "$EXPECTED_COMMIT_SHA" <<'NODE'
import { readFileSync } from 'node:fs'

const [, , healthzPath, targetEnvironment, expectedCommitSha] = process.argv
const payload = JSON.parse(readFileSync(healthzPath, 'utf8'))

if (payload.status !== 'ok') {
  throw new Error(`Expected healthz status "ok" but received "${payload.status}"`)
}

if (payload.app !== 'chatbox-web') {
  throw new Error(`Expected app "chatbox-web" but received "${payload.app}"`)
}

if (payload.buildPlatform !== 'web') {
  throw new Error(
    `Expected buildPlatform "web" but received "${payload.buildPlatform}"`,
  )
}

if (!payload.version) {
  throw new Error('healthz payload is missing version')
}

if (expectedCommitSha && payload.commitSha && payload.commitSha !== expectedCommitSha) {
  throw new Error(
    `Expected commitSha "${expectedCommitSha}" but received "${payload.commitSha}"`,
  )
}

const summary = {
  targetEnvironment,
  version: payload.version,
  commitSha: payload.commitSha ?? null,
  builtAt: payload.builtAt ?? null,
}

console.log(JSON.stringify(summary, null, 2))
NODE
