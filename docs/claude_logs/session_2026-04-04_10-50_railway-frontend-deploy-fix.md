# Session Log: Railway Frontend Build & Deploy Fix

**Date:** 2026-04-04 ~10:50 - 11:55 CDT
**Duration:** ~65 minutes
**Focus:** Fix Railway deployment so frontend loads and connects to API

## What Got Done

- Fixed `Dockerfile` to use `vite build --config vite.web.config.ts` instead of `electron-vite build` (avoids Electron native dep failures in Docker)
- Fixed `Dockerfile` to copy `.npmrc` before `pnpm install` so `node-linker=hoisted` is active during install
- Fixed `src/renderer/stores/authStore.ts` — `API_BASE` now uses `window.location.origin` when served over HTTPS (production), falling back to `localhost:3000` for dev
- Fixed `src/renderer/components/ChatBridgeFrame.tsx` — `resolveAppUrl()` similarly uses `window.location.origin` in production
- Reverted unnecessary `electron.vite.config.ts` externalize plugin changes (no longer needed since Docker doesn't use electron-vite)
- Deployed successfully to Railway via `railway deploy` CLI (upload deploy, since git push triggers were being SKIPPED)
- Frontend now loads and connects to the backend API at https://chatbridgeryoiwata.up.railway.app

## Issues & Troubleshooting

### Issue 1: ENOENT for index.html
- **Problem:** `Error: ENOENT: no such file or directory, stat '/app/release/app/dist/renderer/index.html'` — server running but no frontend files
- **Cause:** The old Dockerfile used `pnpm build:web || echo 'web build skipped'` which silently swallowed the build failure. The `electron-vite build` failed on the main process because `source-map-support` (a transitive dep) wasn't resolvable in Docker
- **Fix:** Switched to `npx vite build --config vite.web.config.ts` which builds only the renderer (the only part needed for web deployment), completely bypassing the main/preload Electron builds

### Issue 2: Externalize plugin didn't work
- **Problem:** Previous fix attempts added a Vite plugin with a `config` hook to set `rollupOptions.external` to a function that externalizes all non-relative imports. Build still failed with the same `source-map-support` error
- **Cause:** The static `rollupOptions.external: Object.keys(packageJson.dependencies)` in the build config overwrote the plugin's function. electron-vite's config processing applied the user config after the plugin hook
- **Fix:** Abandoned the electron-vite approach entirely; used standalone `vite` with `vite.web.config.ts` (renderer-only)

### Issue 3: katex/dist/katex.min.css not found
- **Problem:** After switching to `vite build`, a new error appeared: `Rollup failed to resolve import "katex/dist/katex.min.css"`
- **Cause:** `.npmrc` (which sets `node-linker=hoisted`) was only copied into Docker at the `COPY . .` step, AFTER `pnpm install`. Without it, pnpm used default isolated `node_modules`, so transitive deps like `katex` (from `rehype-katex`) weren't hoisted and not accessible
- **Fix:** Added `.npmrc` to the early `COPY` step: `COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./`

### Issue 4: Railway skipping git push deployments
- **Problem:** Multiple commits (`0a969bcf`, `e294ac54`, `c7fc0ef1`) were pushed to `main` but Railway SKIPPED all of them with "No changes to watched files", despite `src/**` and `Dockerfile` being in watchPatterns
- **Cause:** Unknown — possibly a Railway bug with how it evaluates watchPatterns against the previous deployment's config vs. the new commit's config, or a race condition with concurrent deployments
- **Fix:** Used `railway deploy` CLI (upload deploy) which bypasses watchPattern evaluation and always builds from the local working directory

### Issue 5: Frontend calling localhost:3000 in production
- **Problem:** Login page showed `NetworkError when attempting to fetch resource. (localhost:3000)`
- **Cause:** `API_BASE` in `authStore.ts` derived the API URL from `VITE_CHATBRIDGE_WS_URL` env var, defaulting to `ws://localhost:3000/ws`. In production, this env var isn't set, so it fell back to localhost
- **Fix:** Added an early return in `API_BASE`: if `window.location.protocol === 'https:'`, use `window.location.origin` (same-origin in production). Same pattern applied to `ChatBridgeFrame.tsx`'s `resolveAppUrl()`

## Decisions Made

- **Use standalone vite instead of electron-vite for Docker builds** — electron-vite always builds main+preload+renderer sequentially. Main/preload are Electron-specific and fail in Docker without native deps. Since `vite.web.config.ts` already existed for this purpose, using it is simpler and more reliable than trying to make electron-vite externalize everything.
- **Detect production via HTTPS protocol** — Using `window.location.protocol === 'https:'` as the production signal is simple and accurate. Railway always serves over HTTPS. Local dev uses HTTP. No need for build-time env vars.
- **Use `railway deploy` CLI over git push** — Railway's watchPattern-based git deployments have been unreliable for this project. The CLI upload approach always works.

## Current State

- **Working:** Frontend loads at https://chatbridgeryoiwata.up.railway.app, login/register form renders, API calls go to the correct origin
- **Deployed:** Latest upload deploy `e1750185` is SUCCESS with healthcheck passing
- **Server:** Express backend running, Prisma migrations applied, `ANTHROPIC_API_KEY` and `JWT_SECRET` set
- **Not yet verified:** Login/register flow end-to-end, WebSocket chat, plugin iframe loading, chess/weather/spotify apps

## Next Steps

1. Test login and registration flow on the deployed app
2. Test WebSocket chat (send a message, verify LLM response streams back)
3. Test plugin loading — open a chess/weather app, verify iframe loads and tools register
4. Investigate why Railway keeps skipping git push deployments (watchPatterns issue) — may need to switch to CLI-only deploys or file a Railway support ticket
5. Seed demo app registrations on the deployed database if not already done
6. Verify the second Railway domain (`chatbridge-production-a705.up.railway.app`) — it showed a "Not Found" page, may be an old/orphaned service
