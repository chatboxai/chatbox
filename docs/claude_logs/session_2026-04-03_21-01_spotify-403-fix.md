# Session Log: Spotify OAuth 403 Infinite Loop Fix

**Date:** 2026-04-03 21:01
**Duration:** ~30 minutes
**Focus:** Fix Spotify playlist creation failing with 403 and causing an infinite OAuth reconnect loop

## What Got Done

- Diagnosed two-layer bug: Spotify API returning 403, server mapping it to `auth_required`, iframe re-triggering OAuth popup in a loop
- Fixed `server/src/services/spotify.ts`: split 401 (token expired) and 403 (permission denied) into separate error types
- Fixed `server/src/routes/spotify-internal.ts`: added `permission_denied` handler to both `/search` and `/create-playlist` routes, returning HTTP 403 with a clear diagnostic message
- Fixed `apps/spotify/src/App.tsx`: `handleCreatePlaylist` now handles `permission_denied` by surfacing the error as a tool result without setting `connectionStatus = 'disconnected'` or sending `oauth_request`
- Committed: `fix(spotify): don't treat 403 as auth_required to break OAuth loop` (901f453c)

## Issues & Troubleshooting

- **Problem:** Creating a Spotify playlist via the LLM always fails, the LLM says "authentication has expired", the iframe shows "Connect Spotify", and reconnecting loops back to the same failure.
- **Cause (server-side):** `spotifyFetch` in `spotify.ts` treated both HTTP 401 and HTTP 403 from the Spotify API as `auth_required`. Spotify returns 403 when an app is in development mode and the test account isn't registered as a tester in the Spotify Developer Dashboard. Re-authenticating doesn't fix a 403 — it's an app-level permission issue, not a token issue.
- **Cause (route-side):** `spotify-internal.ts` routes only handled `auth_required`, so `permission_denied` fell through to the generic 500 error handler.
- **Cause (frontend):** `handleCreatePlaylist` in `App.tsx` only checked for `body.error === 'auth_required'` when the request failed. Any other non-OK response threw a generic error. The 401 that came back (from the server mapping 403 → `auth_required`) triggered `setConnectionStatus('disconnected')` and `oauth_request`, starting the reconnect loop.
- **Fix:** Three-file change — separate error types at source (`spotify.ts`), handle at the route level (`spotify-internal.ts`), surface cleanly in the iframe without triggering OAuth (`App.tsx`).

- **Problem (identified, not code-fixed):** Spotify Developer Dashboard app is in development mode, restricting playlist creation to explicitly added test users.
- **Cause:** Spotify's development mode limits API access to 25 users who must be manually added in Dashboard → Settings → User Management.
- **Fix (manual):** Go to developer.spotify.com → the app → Settings → User Management → add the Spotify account being used for testing.

## Decisions Made

- **403 → `permission_denied`, not `auth_required`:** A 403 from Spotify means the app or account lacks permission. Re-authenticating cannot fix this. Mapping it to `auth_required` was wrong and caused the loop. Keeping them as distinct error types allows each to be handled appropriately at every layer.
- **Surface permission errors as tool results, not re-auth prompts:** When `permission_denied` is returned, the iframe posts a `tool_result` with an error message. This lets the LLM respond conversationally with the actual problem rather than sending the user into a broken OAuth loop.
- **Did not change the playlist creation endpoint:** `createPlaylist` still uses `POST /users/{me.id}/playlists` (the correct Spotify API endpoint). The 403 is not caused by the wrong endpoint — it's caused by Spotify's development mode restrictions. No endpoint change was needed.

## Current State

- The infinite OAuth reconnect loop is broken. If Spotify returns 403, the error is now surfaced as a clear message to the LLM and user.
- Playlist creation will still fail with a permission error until the test account is added to the Spotify Developer Dashboard app as a tester.
- All other Spotify functionality (status check, track search) similarly handles `permission_denied` without looping.
- Pre-existing uncommitted changes in `server/src/routes/oauth.ts` (default CLIENT_URL changed from `localhost` to `127.0.0.1`) and `src/main/main.ts` (added `AppUpdater` import) remain unstaged — these are from the previous session.

## Next Steps

1. **Spotify Dashboard:** Add the test Spotify account as a tester at developer.spotify.com → app → Settings → User Management. This is required for playlist creation to succeed in development mode.
2. **Verify end-to-end:** After adding the test user, re-test the "Create a jazz playlist" flow to confirm the full create → add tracks → display playlist flow works.
3. **Commit pre-existing diffs:** Review and commit (or revert) the unstaged changes to `oauth.ts` and `main.ts` from the previous session.
4. **Consider `oauth.ts` CLIENT_URL default:** The default was changed from `http://localhost:3000` to `http://127.0.0.1:3000`. Verify this matches the registered redirect URI in the Spotify Developer Dashboard — a mismatch there would cause OAuth to fail entirely.
