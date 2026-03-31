#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-build-only}"

pnpm build:web

case "$MODE" in
  build-only)
    echo "Web build is ready in release/app/dist/renderer"
    echo "Smoke check with: pnpm serve:web"
    echo "Health check at: http://localhost:3000/healthz.json"
    ;;
  preview)
    npx vercel deploy --target preview -y
    ;;
  prod|production)
    npx vercel deploy --prod -y
    ;;
  *)
    echo "Unknown mode: $MODE"
    echo "Usage: bash release-web.sh [build-only|preview|prod]"
    exit 1
    ;;
esac
