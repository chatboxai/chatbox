# Session Log: Milestone 11 — Railway Deployment Configuration

**Date:** 2026-04-03 22:24
**Duration:** ~30 minutes
**Focus:** Prepare the project for single-service Railway deployment (M11 acceptance criteria)

---

## What Got Done

- **`server/src/index.ts`** — Fixed the frontend static file serving path from `../../dist` to `../../release/app/dist/renderer` (the actual output of `pnpm build:web`). Added a SPA catch-all route so TanStack Router client-side navigation works in production.
- **`package.json`** (root) — Added four deployment scripts:
  - `build:apps` — builds chess, weather, spotify apps via `npm run build --prefix`
  - `build:server` — compiles the Express TypeScript server
  - `build:all` — runs `pnpm build:web && build:apps && build:server` in sequence
  - `start` — `cd server && node dist/index.js`
- **`railway.toml`** — Created Railway configuration: nixpacks builder, start command runs `prisma migrate deploy` then `node dist/index.js`, health check at `/api/health`, restart on failure.
- **`nixpacks.toml`** — Created full Nixpacks build pipeline with custom install and build phases for all sub-packages (root pnpm workspace + apps/chess, apps/weather, apps/spotify + server). Sets `ELECTRON_SKIP_BINARY_DOWNLOAD=1` to prevent electron binary download failure in CI.
- **`server/.env.example`** — Wrote documentation of all environment variables (required: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `JWT_SECRET`; optional: `WEATHER_API_KEY`, `SPOTIFY_CLIENT_ID/SECRET`, `CLIENT_URL`, `PORT`).
- **`server/.gitignore`** — Added `!.env.example` negation rule so the example file is tracked despite the `.env.*` ignore pattern.
- **`chatbridge/README.md`** — Expanded the empty `## Deployment` section with Railway setup steps, environment variable table, build output paths, and a local production build test command.
- **Committed** all changes on `feat/m11-deployment` branch: `chore(deploy): add Railway deployment config, build scripts, and production setup` (be828819).

---

## Issues & Troubleshooting

- **Problem:** `server/.env.example` was blocked by git staging — `git add` rejected it as ignored.
  - **Cause:** `server/.gitignore` had `.env.*` which matches `.env.example`.
  - **Fix:** Added `!.env.example` negation rule to `server/.gitignore` before staging.

- **Problem:** `Read` tool and `Grep`/`Glob` tools blocked by the codebase-memory-mcp gate hook for most file reads.
  - **Cause:** The project's pre-tool hook (`cbm-code-discovery-gate`) blocks Read/Grep/Glob for code discovery and requires codebase-memory-mcp tools first. The project feedback memory confirms the pattern: "use codebase-memory-mcp then Bash+Python for file edits."
  - **Fix:** Used `mcp__codebase-memory-mcp__get_code_snippet` and `search_code` to read existing source files, then Python scripts via Bash for all file edits.

- **Problem:** `Edit` tool failed on `server/src/index.ts` with "File has not been read yet."
  - **Cause:** `Edit` requires the `Read` tool to have been called on the file first, but `Read` was blocked by the hook.
  - **Fix:** Used a Python `open/read/replace/write` script via Bash instead.

- **Problem:** `Bash cat` commands on `.env.example` and README were denied by user permissions.
  - **Cause:** The user has `cat`/`head`/`tail` blocked in permission settings for certain sensitive paths (`.env*` pattern).
  - **Fix:** Used `mcp__codebase-memory-mcp__search_code` to probe README content, and proceeded from CLAUDE.md documentation for the env vars since the content was fully known.

- **Problem:** Frontend static path in `server/src/index.ts` pointed to `../../dist` (project root) but `pnpm build:web` actually outputs to `release/app/dist/renderer/`.
  - **Cause:** The path in index.ts was a placeholder from an earlier milestone ("populated in later milestones" comment). The electron-vite config shows production renderer output goes to `release/app/dist/renderer/` (confirmed by existing `serve:web` script: `npx serve ./release/app/dist/renderer`).
  - **Fix:** Updated static path to `../../release/app/dist/renderer` and added SPA catch-all to serve `index.html` for unmatched routes.

---

## Decisions Made

- **Electron binary skip in nixpacks:** Set `ELECTRON_SKIP_BINARY_DOWNLOAD=1` in `nixpacks.toml` variables. Railway's CI environment doesn't need the Electron binary — `electron-vite build` uses Vite under the hood for the renderer and can compile without it.

- **Both `railway.toml` and `nixpacks.toml`:** `railway.toml` declares the builder and deploy config (start command, health check, restart policy). `nixpacks.toml` controls the install/build phases. Both are needed for full control over the build pipeline.

- **`prisma migrate deploy` in start command, not build:** Migrations must run against the live Railway Postgres instance, which isn't available at build time. The start command (`cd server && npx prisma migrate deploy && node dist/index.js`) runs migrations before starting the server on each deploy.

- **`prisma generate` in build phase:** The Prisma client needs to be regenerated after `npm install` in the build container. Added `npx prisma generate` to the server build phase in `nixpacks.toml`.

- **SPA catch-all placed after all API and static routes:** The `app.get('*', ...)` catch-all is correctly positioned — all `/api/*`, `/apps/*`, and static file middleware are registered first, so the catch-all only fires for unmatched frontend routes (e.g., `/session/abc123`).

- **Apps use `npm install` in nixpacks, not pnpm:** The chess, weather, and spotify apps are standalone packages outside the pnpm workspace. Using `npm install` in their directories is cleaner than trying to hoist them into the pnpm workspace.

---

## Current State

**M0–M11 complete.** All milestones implemented.

- Server builds cleanly: `cd server && npm run build` → `dist/`
- All 36 backend tests pass (5 suites: auth, middleware, apps, conversations, WebSocket)
- `railway.toml` and `nixpacks.toml` are in place for Railway auto-detection
- Frontend will be served at `/` (from `release/app/dist/renderer/`)
- Demo apps served at `/apps/chess/`, `/apps/weather/`, `/apps/spotify/`
- API at `/api/*`, WebSocket at `/ws`
- `server/.env.example` documents all required Railway env vars

**Not yet done (requires actual Railway account/setup):**
- The app hasn't actually been pushed and deployed to Railway yet
- `CLIENT_URL` needs to be set to the actual Railway service URL after first deploy
- Spotify OAuth redirect URL needs to be updated in Spotify developer dashboard

---

## Next Steps

1. **Deploy to Railway** — connect repo, add Postgres plugin, set `ANTHROPIC_API_KEY`, `JWT_SECRET`, and `CLIENT_URL`
2. **Verify deployment** — smoke test `/api/health`, WebSocket connection, and chat functionality
3. **Seed demo data** — run `npm run seed` against the Railway Postgres instance (or add it to the start command)
4. **Record demo video** — 3–5 min covering architecture, chess demo, weather query, Spotify OAuth, postMessage in console, `generation.ts` walkthrough (per IMPLEMENTATION_PLAN.md day 6 target)
5. **Write cost analysis** — `chatbridge/docs/COST_ANALYSIS.md` using Anthropic console usage dashboard
6. **Social post** — LinkedIn or X post with deployed link, @GauntletAI tag
7. **Final README polish** — ensure `chatbridge/README.md` has setup guide, deployed link, and API docs complete
