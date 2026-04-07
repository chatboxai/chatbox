# Session Log: Milestone 8 — Spotify OAuth2 Popup Flow

**Date:** 2026-04-03, ~18:14
**Duration:** ~1.5 hours
**Focus:** Implement Spotify playlist app with full OAuth2 popup flow and server-side token storage

---

## What Got Done

### Backend — new files
- **`server/src/routes/oauth.ts`** — OAuth popup flow routes:
  - `GET /api/oauth/spotify/authorize?token=JWT` — validates JWT, generates CSRF state, redirects to Spotify auth page; shows "not configured" HTML page if credentials missing
  - `GET /api/oauth/spotify/callback` — validates state, exchanges auth code for tokens, upserts into Postgres `OAuthToken` table, renders close-and-notify page (`window.opener.postMessage`)
  - In-memory `pendingStates` Map for CSRF state → userId mapping (10-min TTL, auto-cleaned)
- **`server/src/services/spotify.ts`** — Spotify API service layer: `getSpotifyToken` (auto-refresh within 5 min of expiry), `searchTracks`, `createPlaylist`, `addTracksToPlaylist` (100-track chunking)
- **`server/src/routes/spotify-internal.ts`** — Internal proxy endpoints (all `requireAuth`):
  - `GET /api/internal/spotify/status` — returns `{ connected, configured }`
  - `POST /api/internal/spotify/search` — proxies to Spotify search API
  - `POST /api/internal/spotify/create-playlist` — creates playlist, searches for each track query, adds tracks

### Backend — modified files
- **`server/src/index.ts`** — added `oauthRouter` at `/api/oauth`, `spotifyInternalRouter` at `/api/internal/spotify` (with `requireAuth`), and `/apps/spotify` static serving
- **`server/src/ws/chatHandler.ts`** — added `search_tracks` and `create_playlist` Anthropic tool definitions to `getAnthropicTools()`
- **`server/src/routes/apps.ts`** — added Spotify to the hardcoded `GET /api/apps` response with `authRequired: true, authProvider: 'spotify'`
- **`server/prisma/seed.ts`** — added Spotify `AppRegistration` upsert (status: `'approved'`)

### Frontend — modified files
- **`src/shared/types/chatbridge.ts`** — added `oauth_request` variant to `BridgeMessageSchema` discriminated union
- **`src/renderer/packages/chatbridge/message-handler.ts`** — added `'oauth_request'` to `KNOWN_TYPES`, added optional `onOAuthRequest?: (provider: string) => void` parameter to `createMessageHandler`, handled in switch case
- **`src/renderer/components/ChatBridgeFrame.tsx`** — three additions:
  1. Imports `authStore` and `API_BASE` from `../stores/authStore`
  2. Appends `?token=${encodeURIComponent(token)}` to the iframe URL when `activeApp.authRequired === true`
  3. Passes `handleOAuthRequest` callback to `createMessageHandler` (opens popup via `window.open`)
  4. Separate `handleOAuthComplete` window listener for popup's `oauth_complete` message — forwards `{ type: 'auth_ready', provider }` to the iframe
- **`src/renderer/packages/chatbridge/controller.ts`** — added Spotify to `HARDCODED_FALLBACK_APPS` with `authRequired: true, authProvider: 'spotify'`

### Spotify app — new files (`apps/spotify/`)
- `package.json`, `tsconfig.json`, `vite.config.ts` (base: `/apps/spotify/`, proxy `/api` → `localhost:3000`), `index.html`
- `src/main.tsx`, `src/App.tsx` — React SPA:
  - Reads `?token=JWT` from URL on mount for backend auth
  - Checks `/api/internal/spotify/status` on mount; shows "Connect Spotify" button if disconnected, "Spotify Not Configured" card if unconfigured
  - Sends `{ type: 'oauth_request', provider: 'spotify' }` to parent on button click
  - Handles `auth_ready` from parent — re-checks status, updates UI to "Connected"
  - Handles `tool_invoke` for `search_tracks` and `create_playlist` — calls backend, updates UI, sends `tool_result` and `state_update`
  - Dark theme; track list with album art; created playlists with Spotify deep links and "Open ↗" button

### Verified passing
- `cd server && npx tsc --noEmit` — no errors
- `cd apps/spotify && npx tsc --noEmit` — no errors
- `cd apps/spotify && npm run build` — clean build (152 KB JS)

---

## Issues & Troubleshooting

- **Problem:** `Read` tool (and `Grep`/`Glob`) blocked for all code discovery by the `cbm-code-discovery-gate` hook.
  - **Cause:** Per-project hook requires using `codebase-memory-mcp` tools first for discovery, then Bash/Python for reading/editing.
  - **Fix:** Used `mcp__codebase-memory-mcp__search_graph` and `get_code_snippet` to locate functions, then `Bash cat` to read full file contents.

- **Problem:** `Edit` tool also blocked for files that hadn't been read via the approved path.
  - **Cause:** Same hook — `Edit` requires the file to have been read first.
  - **Fix:** Used `python3` via Bash to do in-memory string replacements and write files directly.

- **Problem:** `authStore` and `API_BASE` were missing from `ChatBridgeFrame.tsx` at import time — TypeScript reported `Cannot find name 'authStore'`.
  - **Cause:** Two separate Python scripts were run. The first (a check script) found the old string and printed "Step 1 OK" but did **not** write the file. The second script (which did write) started at step 2, so the import was never inserted.
  - **Fix:** Ran a third Python script that targeted just the import line and wrote the file.

- **Problem:** Frontend `pnpm run typecheck` failed with `ERR_PNPM_UNSUPPORTED_ENGINE` (Node 24 vs expected `>=20 <23`).
  - **Cause:** Project's `package.json` `engines` field excludes Node 24.
  - **Fix:** Verified frontend types by running `npx tsc --noEmit -p tsconfig.web.json` directly and by checking that no ChatBridge-related errors appeared in the output.

---

## Decisions Made

- **JWT passed as `?token=` URL query param to auth-required iframes** — The simplest way for the Spotify iframe to authenticate backend calls. Alternative (postMessage `auth_token`) would require the parent to proactively push the token after load. URL param is read once on mount and stored in a `useRef`.

- **`oauth_request` handled in `createMessageHandler` (not a separate window listener)** — Because `oauth_request` comes from the iframe (`event.source` check passes), it belongs in the existing per-iframe handler. Added it as an optional `onOAuthRequest` callback parameter to keep the handler pure/testable.

- **`oauth_complete` handled in `ChatBridgeFrame` (separate global listener)** — Because `oauth_complete` comes from the popup window (`window.opener.postMessage`), not the iframe. Only `ChatBridgeFrame` has access to `iframeRef` to forward `auth_ready` back to the iframe.

- **CSRF state stored in-memory Map** — `Map<state, { userId, expiresAt }>` with a 10-minute TTL and 5-minute cleanup interval. Sufficient for a single-instance sprint deployment. A Redis store would be needed for multi-instance production.

- **`/api/internal/spotify` mounted before `/api/internal`** — Express processes routes in registration order. The more-specific Spotify path must be registered first to avoid the general `internalRouter` catching it (which has no auth and no Spotify routes).

- **Graceful no-credentials mode** — The `/authorize` endpoint renders a styled HTML page explaining the missing config rather than a raw error. The Spotify app itself shows an "unconfigured" card. This satisfies the acceptance criterion "app loads without credentials."

---

## Current State

**Fully implemented (M0–M8):**
- Basic WebSocket chat with Claude streaming (M0)
- `activate_app` tool, ChatBridgeFrame side panel, postMessage protocol (M1–M2)
- Full backend tool call loop with Anthropic API (M3)
- Chess app — stateful game, AI move suggestions, FEN state (M4)
- JWT auth with bcrypt, demo user seeding (M5)
- Auth UI (M6)
- Weather dashboard — server-side OpenWeatherMap proxy, mock fallback (M7)
- Spotify playlist creator — OAuth2 popup flow, token storage in Postgres, search + create (M8)

**OAuth token flow (end-to-end):**
1. Spotify iframe shows "Connect Spotify" button
2. Click → `oauth_request` postMessage → ChatBridgeFrame opens popup
3. Popup → `/api/oauth/spotify/authorize` → redirects to Spotify
4. Spotify → `/api/oauth/spotify/callback` → token stored in `OAuthToken` table
5. Callback page → `window.opener.postMessage({ type: 'oauth_complete' })` → closes
6. ChatBridgeFrame receives `oauth_complete` → sends `auth_ready` to iframe
7. Iframe re-checks status → shows "Connected"
8. Tool invocations call backend proxy with JWT → backend uses stored token

**Typechecks passing:** server, apps/spotify

**Not yet done:**
- Error handling polish (M9)
- Tests (M10)
- Railway deployment (M11)
- Demo video
- Cost analysis document
- Social post

---

## Next Steps

1. **M9 — Error handling polish**: loading spinners on tool calls, retry buttons, circuit breaker UI for 3 consecutive app failures, graceful WebSocket reconnect
2. **M10 — Tests**: auth endpoint tests (supertest), postMessage protocol tests (vitest), tool schema conversion tests
3. **M11 — Deploy to Railway**: `prisma migrate deploy` in start command, set env vars (`ANTHROPIC_API_KEY`, `JWT_SECRET`, `DATABASE_URL`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`), add Railway domain to Spotify app's redirect URI whitelist
4. **Spotify Developer Dashboard**: register redirect URI for the Railway deployment URL (currently only `http://localhost:3000` is registered)
5. **Demo video**: record 3–5 min covering architecture, chess game, weather query, Spotify OAuth + playlist creation, postMessage in devtools console
6. **Cost analysis**: write `chatbridge/docs/COST_ANALYSIS.md` using Anthropic console usage data
7. **Social post**: LinkedIn/X with screenshots, @GauntletAI tag, deployed link
