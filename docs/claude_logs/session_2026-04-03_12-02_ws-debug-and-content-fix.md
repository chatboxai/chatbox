# Session Log: WebSocket Debug and Content Extraction Fix

**Date:** 2026-04-03 12:02
**Duration:** ~30 minutes
**Focus:** Diagnose WebSocket connection failure and fix empty-content bug in ChatBridge message interception

## What Got Done

- Diagnosed root cause of "WebSocket connection failed" error shown in the Electron app
- Identified PostgreSQL 18 cluster as stopped (not a code bug)
- Confirmed `VITE_CHATBRIDGE_WS_URL` is correctly set in `.env.local` pointing to `ws://localhost:3000`
- Read the full ChatBridge interception block in `src/renderer/stores/session/generation.ts` via codebase-memory-mcp
- Fixed content extraction bug: replaced `targetMsg.contentParts` lookup with `messages.slice(0, targetMsgIx).findLast(m => m.role === 'user')` lookup
- Added empty-content guard that logs a warning and falls through to the normal Chatbox pipeline instead of sending empty content to Anthropic
- Committed fix: `a7b2efbc` — `fix(chatbridge): extract user message content from session messages list`

## Issues & Troubleshooting

- **Problem:** Server crashed on startup with `PrismaClientInitializationError: Can't reach database server at localhost:5432`
  - **Cause:** PostgreSQL 18 cluster was installed but not running (`pg_lsclusters` confirmed both PG 14 and PG 18 clusters were `down`)
  - **Fix:** Infrastructure fix — user must run `sudo pg_ctlcluster 18 main start` to bring the DB up; no code change needed

- **Problem:** `/api/apps` returning HTML (`<!DOCTYPE ...`) instead of JSON, causing `SyntaxError: Unexpected token '<'` in the frontend
  - **Cause:** The Express server never started (crashed on DB connection failure), so requests fell through to Vite's dev server which returned its index.html
  - **Fix:** Same as above — start PostgreSQL so the Express server can boot

- **Problem:** WebSocket reconnecting indefinitely to `ws://localhost:3000` with close code 1006
  - **Cause:** Express + WebSocket server on port 3000 was never listening (server crashed before `server.listen()`)
  - **Fix:** Start PostgreSQL; the `ws-client.ts` reconnect logic is correct and working as designed

- **Problem:** Anthropic returning `"messages.0: user messages must have non-empty content"` when a message was sent via ChatBridge
  - **Cause:** `generate()` was reading content from `targetMsg` (the assistant placeholder message with `generating: true`), which has empty `contentParts`. The actual user text lives in the `messages[]` array from the session, not in the placeholder
  - **Fix:** Replaced the buggy line `targetMsg.contentParts.find(p => p.type === 'text')?.text ?? ''` with a lookup against `messages.slice(0, targetMsgIx).findLast(m => m.role === 'user')?.contentParts.find(p => p.type === 'text')?.text ?? ''`. Both `messages` and `targetMsgIx` were already computed just above the `try` block and were available at the interception point

## Decisions Made

- **No code change for the PostgreSQL issue.** The server's `start()` function correctly calls `process.exit(1)` on DB failure (fail-fast is the right behavior). The fix is operational, not architectural.
- **Guard falls through to normal pipeline, not throws.** When content is empty after extraction, the ChatBridge block is bypassed silently (with a console warning) and the normal Chatbox generation pipeline runs. This is safer than throwing — an edge case with no user content shouldn't break the entire chat.
- **`messages` / `targetMsgIx` reused rather than re-fetching session.** Both variables are already resolved earlier in `generate()` (with thread fallback logic included), so reusing them is correct and avoids a redundant `chatStore.getSession()` call.

## Current State

- **Frontend (Electron):** Running, ChatBridge interception in `generation.ts` is now sending the correct user message content to the backend
- **Backend (Express + WebSocket):** Crashes on startup because PostgreSQL is not running — requires `sudo pg_ctlcluster 18 main start` before the server will listen on port 3000
- **`ws-client.ts`:** Has uncommitted local modifications (noted in git status at session start) — not reviewed this session
- **ChatBridge flow (when server is up):** `activate_app` → tool injection → user sends message → `generate()` intercepts → WS sends correct content → Anthropic responds → streams tokens back to UI

## Next Steps

1. Start PostgreSQL (`sudo pg_ctlcluster 18 main start`) and verify server boots cleanly with all env vars set
2. Review uncommitted changes in `src/renderer/packages/chatbridge/ws-client.ts` — determine if they need to be committed or reverted
3. End-to-end test: activate Test App → send a message → confirm it reaches Anthropic without empty-content error → confirm streamed response renders in chat UI
4. Implement M2 iframe wiring so `onToolCall` in the WS client can actually forward to the iframe instead of returning `{ error: 'iframe not ready' }`
5. Verify `/api/apps` fallback registry behavior when server is unavailable — consider whether the warning should surface in the UI
