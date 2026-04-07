# Session Log: Railway Frontend Build — ENOENT index.html Fix

**Date:** 2026-04-04 10:16 UTC-5
**Duration:** ~45 minutes
**Focus:** Fixing Railway deployment error where frontend index.html was missing at runtime

## What Got Done

- Diagnosed the root cause: `pnpm build:web` silently failing in Docker, producing no renderer output
- Identified that `electron-vite build` builds main/preload/renderer sequentially, and the main process build was failing on unresolvable imports (`source-map-support`, `adm-zip`, etc.) because `externalizeDepsPlugin()` was only used in dev mode
- Modified `electron.vite.config.ts` to use a custom "externalize all non-relative imports" plugin when `CHATBOX_BUILD_PLATFORM=web`, so main/preload builds succeed in Docker without Electron native deps
- Updated `Dockerfile` to run `electron-vite build` directly instead of `pnpm build:web` (which chains a broken `delete-sourcemaps` step)
- Created `vite.web.config.ts` as an alternative renderer-only build config (ultimately not used — kept in repo)
- Added `*.config.*`, `electron.vite.config.ts`, `vite.web.config.ts` to Railway `watchPatterns` in `railway.toml`
- Pushed multiple fix attempts and triggered Railway deployments

## Issues & Troubleshooting

### Issue 1: ENOENT /app/release/app/dist/renderer/index.html
- **Problem:** Railway deployment showed `Error: ENOENT: no such file or directory, stat '/app/release/app/dist/renderer/index.html'` — the server's SPA catch-all couldn't find the frontend build
- **Cause:** `pnpm build:web` runs `electron-vite build && pnpm run delete-sourcemaps`. The `delete-sourcemaps` step fails (ts-node can't find `.erb/scripts/delete-source-maps-runner.js`). The whole command exits non-zero, and the Dockerfile's `|| echo 'web build skipped'` silently swallowed the failure. However, `electron-vite build` itself was ALSO failing — so no renderer output was produced.
- **Fix:** Replaced `pnpm build:web || echo 'web build skipped'` with `npx cross-env CHATBOX_BUILD_PLATFORM=web npx electron-vite build` (no silent fallback)

### Issue 2: electron-vite main build fails on source-map-support
- **Problem:** `electron-vite build` builds main → preload → renderer sequentially. The main process build failed: `Rollup failed to resolve import "source-map-support"`
- **Cause:** In production mode, the electron.vite.config.ts used `externalizeDepsPlugin()` only in dev (non-production). In production, it used `rollupOptions.external: Object.keys(packageJson.dependencies)` from `release/app/package.json`, which only has 3 packages. `source-map-support` and dozens of other Electron deps (electron, electron-debug, etc.) weren't externalized.
- **Fix (partial):** Changed config to use `externalizeDepsPlugin()` when `isWeb` is true. But `externalizeDepsPlugin` only externalizes `dependencies` from the nearest `package.json`, and `source-map-support` isn't listed there.

### Issue 3: Whack-a-mole with individual missing externals
- **Problem:** After fixing `source-map-support`, the build failed on `adm-zip`, then would fail on more
- **Cause:** `externalizeDepsPlugin({ include: [...] })` was a losing battle — too many unlisted transitive deps
- **Fix:** Replaced `externalizeDepsPlugin` with a custom inline plugin that externalizes ALL non-relative imports when `isWeb=true`. This makes main/preload builds trivially succeed since nothing gets bundled.

### Issue 4: vite.web.config.ts katex resolution failure in Docker
- **Problem:** Alternative approach using plain `vite build --config vite.web.config.ts` failed in Docker with `Rollup failed to resolve import "katex/dist/katex.min.css"`
- **Cause:** With `root: 'src/renderer'`, Vite's module resolution started from `/app/src/renderer/` and couldn't find `katex` in the project root's `node_modules` (pnpm hoisting + Vite resolution quirk). Worked locally but not in Docker.
- **Fix:** Abandoned this approach in favor of fixing electron-vite directly

### Issue 5: Railway watchPatterns not detecting config file changes
- **Problem:** Railway git-triggered deploys showed "SKIPPED: No changes to watched files" even though `electron.vite.config.ts` changed
- **Cause:** `railway.toml` watchPatterns didn't include root-level config files
- **Fix:** Added `"*.config.*", "electron.vite.config.ts", "vite.web.config.ts"` to watchPatterns

### Issue 6: `railway deploy` upload timing vs local edits
- **Problem:** Upload-based deploys (`railway deploy`) were using stale code
- **Cause:** The deploy was triggered before the latest commit/edit was saved. Railway CLI uploads the directory contents at invocation time.
- **Fix:** Re-triggered deploy after confirming local files were up to date

## Decisions Made

- **Externalize all node_modules for web builds** — Since the main/preload Electron builds aren't used in the Docker deployment (only the renderer is served), it's safe to externalize everything. This avoids maintaining a list of Electron-specific deps.
- **Keep electron-vite over plain vite** — electron-vite handles renderer root, module resolution, and CSS imports correctly (katex issue). Fighting plain vite's resolution was harder than making electron-vite's main build succeed.
- **Keep vite.web.config.ts in repo** — Even though it's not currently used, it's a useful fallback if electron-vite causes future issues. It works locally.
- **Remove silent `|| echo` fallback** — Build failures should be visible, not silently swallowed. The Dockerfile now fails loudly if the frontend build fails.

## Current State

- **Build status:** The latest fix (externalize-all plugin) works locally — all three electron-vite targets build successfully with `CHATBOX_BUILD_PLATFORM=web`
- **Railway deployment:** A deploy (`00ea5f17`) was triggered with the correct local files but hasn't completed yet (session ended during the wait)
- **What's working:** Server starts, healthcheck passes, Prisma migrations run. The missing piece is the frontend renderer build completing in Docker.
- **Commits pushed:** 6 fix commits on `main` during this session (`e77778eb` through `0a969bcf`)

## Next Steps

1. **Check Railway deployment `00ea5f17` status** — Verify it succeeded or check build logs for new errors
2. **If deploy succeeded:** Test the live site at `chatbridgeryoiwata.up.railway.app` — verify the frontend loads, not just the health check
3. **If deploy failed:** Check logs for the specific error — likely a new module resolution issue in the renderer build
4. **Clean up:** Consider squashing the 6 deployment fix commits into one clean commit
5. **Delete `vite.web.config.ts`** if electron-vite approach is confirmed working (or keep as documented fallback)
6. **Verify app functionality:** Once frontend loads, test WebSocket chat, plugin iframe loading, chess/weather/spotify apps
