# Session Log: Fix iframe sandbox blocking all ChatBridge app loading

**Date:** 2026-04-04 ~16:30 UTC
**Duration:** ~30 minutes
**Focus:** Diagnose and fix "App failed to load" error for all ChatBridge plugin apps (Chess, Weather, Spotify) on the deployed Railway instance.

## What Got Done

- Identified root cause: `sandbox="allow-scripts"` without `allow-same-origin` on the iframe in `ChatBridgeFrame.tsx` caused all plugin apps to crash silently before sending the `ready` postMessage
- Committed fix (`4bfc855e`): `fix(chatbridge): add allow-same-origin to iframe sandbox so apps can initialize`
- Deployed fix to Railway via `railway up` (new JS bundle hash `CVhpexVz` confirmed live)
- Verified fix on deployed instance using Playwright MCP:
  - `sandbox="allow-scripts"` only: 0 messages received from iframe (broken)
  - `sandbox="allow-scripts allow-same-origin"`: 2 messages received (`ready` + `register_tools`)
  - Chess app loads standalone with 0 console errors post-deploy

## Issues & Troubleshooting

### Primary Issue: All apps show "App failed to load"

- **Problem:** Every ChatBridge plugin app (Chess, Weather, Spotify) displayed "App failed to load" with a Retry button in the side panel iframe. The 5-second `ready` timeout was firing because no `ready` postMessage was ever received from the iframe.
- **Cause:** The iframe had `sandbox="allow-scripts"` without `allow-same-origin`. This gives the iframe an opaque `null` origin, which blocks browser APIs like `localStorage` and `sessionStorage`. React apps crash during initialization when they can't access these APIs (or libraries they depend on use them). The crash happens before the `useEffect` that sends `window.parent.postMessage({ type: 'ready' }, '*')` ever fires.
- **Fix:** Added `allow-same-origin` to the sandbox attribute. Since all plugin apps are self-hosted on the same Railway origin (served as static files from Express at `/apps/{name}`), this is safe — it doesn't grant cross-origin access, just lets apps use their normal browser APIs. Also tightened `postMessage` targetOrigin from wildcard `'*'` to the resolved app origin, and fixed the `invokeToolAndWait` dependency array.

### Troubleshooting Steps Taken

1. **Checked app registration and URLs** — Verified `/api/apps` returns all 4 apps with correct `/apps/{name}` URLs and `approved` status
2. **Checked static file serving** — Verified `express.static` paths, Vite `base` config, and Docker build all produce correct `dist/` output; confirmed chess app HTML and JS are served correctly at the deployed URL
3. **Loaded chess app standalone in Playwright** — Works perfectly, renders chessboard, 0 console errors. Ruled out build/serving issues.
4. **Checked HTTP headers** — No `X-Frame-Options` or `Content-Security-Policy` headers blocking iframe embedding
5. **Tested manual iframe creation in browser** — Created iframe via `document.createElement` with `sandbox="allow-scripts allow-same-origin"` and received both `ready` and `register_tools` messages. This confirmed postMessage protocol itself works.
6. **Tested with `sandbox="allow-scripts"` only** — 0 messages received. This isolated the sandbox attribute as the root cause.
7. **Checked git diff** — Found uncommitted local changes already had the fix but it had never been deployed

### Secondary Issue: Chatbox upstream CORS errors

- **Problem:** 70+ console errors from `api.chatboxai.app` CORS failures on every page load
- **Cause:** The forked Chatbox frontend still tries to reach the upstream Chatbox AI API, which doesn't have CORS headers for the Railway domain
- **Fix:** Not addressed — these are cosmetic errors from the upstream fork and don't affect ChatBridge functionality

### Secondary Issue: express-rate-limit X-Forwarded-For warning

- **Problem:** `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` errors in Railway server logs
- **Cause:** Railway's reverse proxy sets `X-Forwarded-For` but Express `trust proxy` is not configured
- **Fix:** Not addressed in this session — functional but should be fixed to ensure rate limiting uses the correct client IP

## Decisions Made

- **`allow-same-origin` is acceptable for self-hosted apps** — Per the security rules, `allow-same-origin` should only be added for "trusted self-hosted demo apps." Since all current apps (Chess, Weather, Spotify) are self-hosted and served from the same Express server, this is the correct configuration. Third-party untrusted apps would need a different approach (e.g., serving from a separate origin).
- **Tightened postMessage targetOrigin** — Changed from `'*'` (wildcard) to `new URL(resolvedBase).origin` for both `tool_invoke` and `auth_ready` messages. With `allow-same-origin`, the iframe has a proper origin, so we can validate it.
- **Deployed via `railway up` rather than waiting for git-triggered deploy** — The git push went to the Gauntlet remote, and it wasn't clear if Railway auto-deploys from that. Used `railway up --detach` for immediate deployment.

## Current State

- **Deployed and working:** The iframe sandbox fix is live at `chatbridgeryoiwata.up.railway.app`. The new JS bundle (`CVhpexVz`) is being served.
- **Verified:** Chess app iframe sends `ready` and `register_tools` messages correctly on the deployed instance.
- **Not end-to-end tested in-app:** Due to the Chatbox upstream welcome overlay blocking the chat input in Playwright, a full in-app test (type "let's play chess" → activate_app → iframe loads → chess renders) was not completed in automation. Manual testing by the user is needed.
- **Server healthy:** `/api/health` returns `{"status":"ok"}`, WebSocket connections are working.

## Next Steps

1. **Manual E2E test** — Open `chatbridgeryoiwata.up.railway.app`, log in as demo, start a new chat, type "let's play chess" and verify the chess app loads in the side panel without the "App failed to load" error
2. **Test Weather and Spotify apps** — Verify they also load correctly (same root cause, same fix)
3. **Fix `trust proxy` for rate limiting** — Add `app.set('trust proxy', 1)` to `server/src/index.ts` so `express-rate-limit` correctly identifies client IPs behind Railway's reverse proxy
4. **Test Retry button** — Verify the Retry button in the ChatBridgeFrame header works (increments `retryKey`, remounts iframe)
5. **Consider the Chatbox upstream CORS errors** — Low priority, but could suppress by patching out the upstream API calls or adding a no-op proxy
