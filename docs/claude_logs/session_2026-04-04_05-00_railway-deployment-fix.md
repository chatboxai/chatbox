# Session Log: Fix Railway Deployment — Builder, Config, and Database

**Date:** 2026-04-04 ~05:00–05:45 UTC
**Duration:** ~45 minutes
**Focus:** Debug and fix a chain of Railway deployment failures preventing the ChatBridge server from going live.

## What Got Done

- Fixed Railway builder from Nixpacks to Dockerfile (uppercase `"DOCKERFILE"` in `railway.toml`)
- Deleted `nixpacks.toml` — no longer needed with Dockerfile builder
- Added `COPY patches/ patches/` to Dockerfile so `pnpm install` can find patched dependencies (libsql, mdast-util-gfm-autolink-literal)
- Added `--ignore-scripts` to `pnpm install` in Dockerfile to skip Electron-specific postinstall hooks (electron-rebuild, zipfile native compile)
- Wrapped `startCommand` in `sh -c '...'` in `railway.toml` since Railway exec-style execution can't run shell builtins like `cd`
- Set comprehensive `watchPatterns` in `railway.toml` to override the dashboard's restrictive `/release/app/**` pattern
- Updated `DATABASE_URL` on the chatbridge Railway service from `localhost:5432` to `postgres.railway.internal:5432/railway`
- Linked Railway CLI to the `desirable-courage` project and `chatbridge` service
- Pushed all fixes to both `github` and `origin` remotes
- Successfully deployed: Prisma migrations applied, server running on port 3000, healthcheck passing

## Issues & Troubleshooting

### 1. Nixpacks builder used instead of Dockerfile
- **Problem:** Build failed with exit code 127 — `npm` not found during Nixpacks build. The `railway.toml` said `builder = "dockerfile"` but Railway used Nixpacks anyway.
- **Cause:** Railway config-as-code requires uppercase builder values (`"DOCKERFILE"`, `"RAILPACK"`). Lowercase `"dockerfile"` was not recognized, so Railway fell back to the service-level dashboard setting of `NIXPACKS`. Additionally, the presence of `nixpacks.toml` reinforced Nixpacks selection.
- **Fix:** Changed `builder = "DOCKERFILE"` (uppercase) in `railway.toml` and deleted `nixpacks.toml`.

### 2. Deployments skipped due to watch patterns
- **Problem:** Multiple `railway up` deployments were SKIPPED with "No changes to watched files".
- **Cause:** The Railway dashboard had `watchPatterns: ["/release/app/**"]` set on the service, so only changes to files under `release/app/` triggered builds. Config file changes, Dockerfile changes, and server code changes were all ignored.
- **Fix:** Added comprehensive `watchPatterns` in `railway.toml` to override the dashboard setting: `["src/**", "server/**", "apps/**", "Dockerfile", "railway.toml", "package.json", "pnpm-lock.yaml", "release/**", "patches/**"]`.

### 3. Git push to wrong remote
- **Problem:** `git push origin main` went to `labs.gauntletai.com`, but Railway watches the GitHub repo `ryoiwata/chatbox`.
- **Cause:** `origin` remote pointed to Gauntlet's git server, not GitHub. The `github` remote was the correct one for triggering Railway auto-deploys.
- **Fix:** Started pushing to both remotes: `git push github main && git push origin main`.

### 4. Missing patch files during pnpm install
- **Problem:** `pnpm install --frozen-lockfile` failed with `ENOENT: no such file or directory, open '/app/patches/libsql@0.5.22.patch'`.
- **Cause:** The Dockerfile copied `package.json` and `pnpm-lock.yaml` before `pnpm install` for layer caching, but didn't copy the `patches/` directory that the lockfile references.
- **Fix:** Added `COPY patches/ patches/` to the Dockerfile before the `pnpm install` step.

### 5. Electron postinstall scripts failing
- **Problem:** `pnpm install` failed trying to run `electron-rebuild`, compile `zipfile` native module (needs Python), and execute `.erb/scripts/postinstall.cjs`.
- **Cause:** The Chatbox monorepo has Electron-specific postinstall hooks that require native build tools not present in `node:20-slim`. These are unnecessary for the web/server-only deployment.
- **Fix:** Added `--ignore-scripts` flag to `pnpm install` in the Dockerfile.

### 6. Container start command fails — "executable cd not found"
- **Problem:** Docker build succeeded (199s) but container failed to start: `The executable 'cd' could not be found.`
- **Cause:** Railway's `startCommand` in `railway.toml` runs the command exec-style (directly), not through a shell. `cd` is a shell builtin, not a standalone executable.
- **Fix:** Wrapped the start command in `sh -c '...'`: `startCommand = "sh -c 'cd server && npx prisma migrate deploy && node dist/index.js'"`.

### 7. DATABASE_URL pointing to localhost
- **Problem:** Container started but Prisma failed with `P1001: Can't reach database server at localhost:5432`.
- **Cause:** The `DATABASE_URL` environment variable on the chatbridge service was manually set to `postgresql://postgres:postgres@localhost:5432/chatbridge` instead of using Railway's internal Postgres URL.
- **Fix:** Updated `DATABASE_URL` via Railway MCP to `postgresql://postgres:...@postgres.railway.internal:5432/railway`.

## Decisions Made

- **Dockerfile over Nixpacks** — The Dockerfile builder gives full control over the build environment (`node:20-slim` has npm/node in PATH natively). Nixpacks added complexity with nix package paths and garbage collection that broke npm discovery.
- **`--ignore-scripts` over installing build tools** — Rather than adding Python and build-essential to the Docker image for Electron native modules we don't need, we skip all postinstall scripts. The web frontend build (`pnpm build:web`) still works (though it currently fails on `source-map-support` and falls through to the `|| echo` fallback — this is acceptable since the server is the primary artifact).
- **Comprehensive watchPatterns in config** — Overriding the dashboard's `/release/app/**` pattern ensures all meaningful code changes trigger deployments without needing to touch an unrelated file.
- **Internal Postgres URL** — Used `postgres.railway.internal:5432` (private networking) rather than the public proxy URL for lower latency and security.

## Current State

- **Deployed and running:** ChatBridge server is live on Railway at `chatbridge-production-a705.up.railway.app`
- **Database:** Prisma migrations applied (init + app_registration_oauth), Postgres connected via internal networking
- **API keys:** ANTHROPIC_API_KEY, JWT_SECRET, SPOTIFY credentials, WEATHER_API_KEY all configured
- **Web frontend:** `pnpm build:web` fails (missing `source-map-support` due to `--ignore-scripts` skipping Electron deps) but falls through gracefully — the server still deploys
- **Demo apps:** Chess, weather, and spotify apps all build successfully in Docker
- **Healthcheck:** `/api/health` endpoint configured and passing

## Next Steps

1. **Fix `pnpm build:web`** — The web frontend build fails because `electron-vite` tries to build the Electron main process which imports `source-map-support`. Consider using a web-only Vite config or adding `source-map-support` as an explicit dependency to fix the web build.
2. **Verify API endpoints** — Test `/api/auth/register`, `/api/auth/login`, `/api/apps`, and WebSocket connectivity against the deployed instance.
3. **Seed demo apps** — Run `npm run seed` against the deployed database to register chess, weather, and spotify apps as approved.
4. **Set CLIENT_URL correctly** — Currently set to `chatbridgeryoiwata.up.railway.app` (missing protocol). Should be `https://chatbridge-production-a705.up.railway.app` or the actual frontend URL.
5. **Test the 7 E2E scenarios** from the requirements doc against the deployed app.
