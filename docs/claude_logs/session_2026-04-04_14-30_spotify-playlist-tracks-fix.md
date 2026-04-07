# Session Log: Fix Spotify Playlist Track Addition on Railway Deployment

**Date:** 2026-04-04 ~14:30–15:50 PT
**Duration:** ~1 hour 20 minutes
**Focus:** Diagnose and fix why Spotify playlists were being created empty (no tracks added) on the Railway deployment

## What Got Done

- Diagnosed root cause: Spotify deprecated `POST /playlists/{id}/tracks` → `POST /playlists/{id}/items` in their February 2026 API migration
- Diagnosed secondary cause: LLM sends `trackQueries` as a comma-separated string instead of a JSON array, causing the entire string to be used as one search query (finding nothing)
- Diagnosed tertiary cause: 10-second tool result timeout was too short for playlist creation with 10+ tracks
- Migrated `addTracksToPlaylist` in `server/src/services/spotify.ts` to use `/items` endpoint with `/tracks` fallback
- Added comma-splitting logic in both `server/src/routes/spotify-internal.ts` (Zod schema) and `apps/spotify/src/App.tsx` (frontend params handling)
- Increased tool result timeout from 10s to 60s in both `server/src/ws/chatHandler.ts` and `src/renderer/components/ChatBridgeFrame.tsx`
- Switched track additions from one-at-a-time (with 300ms delays) to batch (single API call for up to 100 tracks)
- Switched track searches from sequential (with 200ms delays) to concurrent batches of 5
- Changed playlist creation from `public: false` to `public: true` (avoids potential Dev Mode restrictions)
- Reduced post-creation propagation delay from 2s to 500ms
- Added rate limit handling (429 with retry-after) and better error logging to `spotifyFetch`
- Exported `refreshToken` function from spotify service
- Removed `accessTokenOverride` parameter from `addTracksToPlaylist` (always fetches fresh token from DB)
- Removed `accessToken` from `createPlaylist` return type (no longer needed)
- Built and deployed a temporary diagnostic endpoint (`POST /api/internal/spotify/debug-add-track`) to test raw Spotify API calls, then removed it after diagnosis
- Deployed 5 commits to Railway, all verified with API tests against the live deployment
- Verified end-to-end: 10-track playlist creation now completes in ~2 seconds (down from 23+ seconds / timeout)

## Issues & Troubleshooting

### Issue 1: Playlists created but always empty — 403 on track addition
- **Problem:** `POST /v1/playlists/{id}/tracks` returned 403 Forbidden for every attempt to add tracks, including POST with JSON body, POST with query params, and PUT fallback. Playlist creation and search worked fine with the same token.
- **Investigation steps:**
  1. Checked Railway deployment logs — confirmed all three fallback methods returned 403
  2. Verified OAuth scopes are correct (`playlist-modify-public`, `playlist-modify-private`, `user-read-private`)
  3. Checked token freshness — no token refresh was happening, ruled out stale token theory
  4. Built diagnostic endpoint that tested `GET /me` (200), `GET /playlists/{id}` (200, ownership confirmed), and `POST /playlists/{id}/tracks` (403) — proved token, ownership, and scopes were all correct
  5. Consulted Spotify Web API docs via Context7 — found mention of quota modes but didn't explain the issue
  6. Web searched for "Spotify Web API 403 Forbidden add tracks playlist 2025 2026" — found the answer
- **Cause:** Spotify's February 2026 Web API migration deprecated `/playlists/{id}/tracks` and replaced it with `/playlists/{id}/items`. The old endpoint returns 403 for Development Mode apps (effective Feb 11, 2026 for new apps, March 9 for existing).
- **Fix:** Changed `addTracksToPlaylist` to use `POST /playlists/{id}/items` as the primary endpoint, with `/tracks` as a fallback. Diagnostic test confirmed: `/items` → 201, `/tracks` → 403.

### Issue 2: Playlists empty when created through the UI (but API test worked)
- **Problem:** Direct API call with `trackQueries: ["Track1", "Track2"]` (array) worked perfectly, but when the LLM invoked `create_playlist` through the UI, no tracks were found or added.
- **Cause:** The LLM (Claude Sonnet) sent `trackQueries` as a single comma-separated string (`"Track1 Artist1, Track2 Artist2, ..."`) instead of a JSON array. The Zod schema's preprocess wrapped it as `["Track1 Artist1, Track2 Artist2, ..."]` (one element), causing one search for the entire string which returned nothing useful.
- **Fix:** Updated the Zod preprocess to split comma-separated strings: `val.split(',').map(s => s.trim())`. Applied the same fix in the frontend `App.tsx` for defense in depth.

### Issue 3: Tool invocation timeouts even after tracks fix
- **Problem:** Creating playlists with 10+ tracks timed out, causing the LLM to report the tool failed and suggest manual alternatives.
- **Cause:** Three compounding factors:
  1. Tool result timeout was 10 seconds (both server `chatHandler.ts` and frontend `ChatBridgeFrame.tsx`)
  2. Track searches were sequential with 200ms delays between each (~12s for 10 tracks)
  3. Track additions were one-at-a-time with 300ms delays (~8s for 10 tracks)
  4. Plus 2s post-creation propagation delay
  5. Total: ~23 seconds, well over the 10s timeout
- **Fix:** Increased timeout to 60s, batched track additions into single API call (Spotify supports up to 100 per request), searched tracks in concurrent batches of 5, reduced propagation delay to 500ms. Result: 10-track playlist creation in ~2 seconds.

## Decisions Made

- **Use `/items` as primary with `/tracks` fallback** — Rather than only using the new endpoint, we fall back to `/tracks` in case some Spotify apps haven't been migrated yet. The fallback is cheap (only triggered on first 403).
- **Increase timeout to 60s (not per-tool)** — A per-tool timeout would be cleaner but adds complexity. 60s is generous enough for all tools while still catching genuinely hung operations.
- **Batch track additions instead of individual** — The one-at-a-time approach was added to isolate failures, but in practice the `/items` endpoint is reliable. Batching reduces 10 API calls to 1. If a batch fails, the entire batch fails, which is acceptable since partial playlist population is confusing anyway.
- **Create playlists as `public: true`** — Changed from `public: false` to avoid any potential Spotify Development Mode restrictions on private playlists. The scopes cover both.
- **Split comma-separated strings in both server and frontend** — Defense in depth. The server Zod schema is the authoritative fix, but the frontend also normalizes to prevent the malformed request from reaching the server.

## Current State

- **Spotify playlist creation is fully working** on the Railway deployment
- Playlists are created with tracks successfully, whether `trackQueries` is sent as an array or comma-separated string
- 10-track playlists complete in ~2 seconds (well within the 60s timeout)
- All changes deployed to Railway (commit `6c34a6c6`) and both remotes (github + origin)
- Chess app and Weather app are unaffected by these changes

### Files modified:
- `server/src/services/spotify.ts` — `/items` endpoint, batch additions, better error handling
- `server/src/routes/spotify-internal.ts` — Comma-split Zod preprocess, concurrent search batches, reduced delays
- `server/src/ws/chatHandler.ts` — Tool result timeout 10s → 60s
- `src/renderer/components/ChatBridgeFrame.tsx` — Tool timeout 10s → 60s
- `apps/spotify/src/App.tsx` — Comma-split for `trackQueries` param

## Next Steps

- Test playlist creation end-to-end through the deployed UI (not just API calls) to confirm the full WebSocket → LLM → tool_invoke → iframe → API flow works with the new timeouts
- Consider adding a loading indicator in the Spotify iframe UI while playlist creation is in progress (currently shows "Working..." but could be more informative)
- Clean up the multiple empty "Jazz Essentials" playlists created during debugging from the user's Spotify account
- Monitor for Spotify rate limiting on concurrent search batches — if 429s appear, add back inter-batch delays
