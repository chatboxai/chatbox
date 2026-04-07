# Session Log: Spotify OAuth Redirect & Playlist Creation Fix

**Date:** 2026-04-04 12:20
**Duration:** ~30 minutes
**Focus:** Fix Spotify OAuth "redirect_uri: Unsafe" error and 403 on playlist creation in Railway deployment

## What Got Done

- Fixed `CLIENT_URL` Railway environment variable from `chatbridgeryoiwata.up.railway.app` to `https://chatbridgeryoiwata.up.railway.app`
- Added defensive `https://` protocol check in `server/src/routes/oauth.ts` (line 21-22) so missing protocol in `CLIENT_URL` is auto-corrected
- Added `show_dialog=true` to Spotify OAuth authorize URL to force fresh consent screen with all scopes
- Updated `server/src/services/spotify.ts` `spotifyFetch` to accept `userId` and clear stored tokens on 403 (scope mismatch recovery)
- Updated `apps/spotify/src/App.tsx` to switch to disconnected state on `permission_denied`, showing the "Connect Spotify" button for re-auth
- Deployed both fixes to Railway (two deployments triggered)

## Issues & Troubleshooting

### Issue 1: Spotify OAuth "redirect_uri: Unsafe"

- **Problem:** Clicking "Connect Spotify" redirected to Spotify's authorize page which displayed `redirect_uri: Unsafe` and refused to proceed. The redirect URI in the URL bar was `chatbridgeryoiwata.up.railway.app/api/oauth/spotify/callback` — missing `https://`.
- **Cause:** The `CLIENT_URL` Railway environment variable was set to `chatbridgeryoiwata.up.railway.app` without the `https://` protocol prefix. The OAuth route at `server/src/routes/oauth.ts:22` used `CLIENT_URL` directly to build `SPOTIFY_REDIRECT_URI`, resulting in a schemeless URL that Spotify rejected.
- **Fix:** 
  1. Updated Railway variable: `CLIENT_URL=https://chatbridgeryoiwata.up.railway.app`
  2. Added code-level defense: `const CLIENT_URL = rawClientUrl.startsWith('http') ? rawClientUrl : \`https://${rawClientUrl}\``

### Issue 2: Spotify 403 Forbidden on Playlist Creation

- **Problem:** After successfully connecting Spotify (search_tracks worked), `create_playlist` returned a 403 Forbidden error from Spotify's API at `POST /users/{id}/playlists`.
- **Cause:** The stored OAuth token lacked `playlist-modify-public/private` scopes. This happens when a user previously authorized the same Spotify app (same client_id) with fewer scopes — Spotify silently reuses the old authorization grant without re-prompting for newly requested scopes.
- **Fix:**
  1. Added `show_dialog=true` to the Spotify authorize URL parameters to force the full consent screen every time, ensuring all requested scopes are explicitly granted
  2. On 403, the server now deletes the stored token from the database (`prisma.oAuthToken.deleteMany`) so the user must re-authenticate with correct scopes
  3. The Spotify iframe app now switches to "disconnected" state on permission_denied, showing the "Connect Spotify" button

## Decisions Made

- **Defensive protocol check over just fixing the variable:** Added code-level `https://` fallback in addition to fixing the Railway variable, preventing this class of misconfiguration from recurring.
- **Clear token on 403 rather than just error message:** Actively deleting the bad token ensures the next "Connect Spotify" click starts fresh with correct scopes, rather than reusing the insufficient token.
- **`show_dialog=true` always:** Trades a slightly worse UX (user always sees Spotify consent screen) for reliability — ensures scope changes are always picked up.

## Current State

- **Deployed:** Both fixes deployed to Railway (`chatbridgeryoiwata.up.railway.app`)
- **Working:** OAuth redirect_uri now includes `https://`, Spotify authorize page should load correctly
- **Pending verification:** Playlist creation needs manual testing after deployment completes — user must click "Connect Spotify" again to get a token with the correct scopes
- **Other apps:** Chess and Weather apps unaffected by these changes

## Next Steps

1. Verify the deployment completed successfully and test the full Spotify flow end-to-end: Connect -> Search -> Create Playlist
2. Confirm the Spotify redirect URI `https://chatbridgeryoiwata.up.railway.app/api/oauth/spotify/callback` is registered in the Spotify Developer Dashboard
3. Verify the user's Spotify account is added as a tester in the Spotify Developer Dashboard (required for development mode apps)
