# Session Log: Milestone 4 — Chess App Implementation

**Date:** 2026-04-03
**Duration:** ~1 hour
**Focus:** Build the chess iframe app (M4) and wire it into the ChatBridge platform

---

## What Got Done

- Created `apps/chess/` as a React + Vite + TypeScript SPA
  - `package.json` with `react`, `react-dom`, `react-chessboard`, `chess.js`, `vite`, `@vitejs/plugin-react`
  - `vite.config.ts` with `base: '/apps/chess/'` for correct asset paths when served by Express
  - `tsconfig.json` with strict mode, `moduleResolution: bundler`, `jsx: react-jsx`
  - `index.html` minimal entry point

- Created `apps/chess/src/hooks/useChessProtocol.ts` — core postMessage protocol hook:
  - Sends `ready` and `register_tools` (with full chess tool schemas) on mount via `useEffect`
  - Listens for `tool_invoke` messages; dispatches to `start_game`, `make_move`, `get_board_state`
  - Uses `gameRef` + stable setter pattern to avoid stale closure issues in the single-mount event listener
  - `start_game`: initializes new `Chess()`, sets player color, sends `tool_result` + `state_update`
  - `make_move`: creates `new Chess(currentFen)`, validates move (returns error result for illegal moves), sends `tool_result` + `state_update`, sends `completion` on game over
  - `get_board_state`: returns full board state (FEN, turn, moveCount, inCheck, isCheckmate, isDraw, isStalemate, isGameOver)
  - `onDrop`: user drag-and-drop handler, respects player color turn, sends `state_update` + `completion`
  - Uses `new Chess(game.fen())` pattern to create new instances on every move (guarantees React re-render)

- Created `apps/chess/src/App.tsx`:
  - Renders `<Chessboard>` from `react-chessboard` with `position`, `onPieceDrop`, `boardOrientation`, `arePiecesDraggable`
  - Status bar shows turn, check state, game over — color-coded (gold for game over, red for check)
  - Inline styles only (no Tailwind dependency)

- Updated `server/src/ws/chatHandler.ts` — added `Chess` entry to `allTools` in `getAnthropicTools()` with three tools: `start_game`, `make_move`, `get_board_state` (using `input_schema` format for Anthropic API)

- Updated `server/src/routes/apps.ts` — added chess app to hardcoded registry with all three tool schemas (using `parameters` format for internal/client use)

- Updated `server/src/index.ts` — added `app.use('/apps/chess', express.static(...chess/dist))` before the existing `/apps` catch-all to serve the built SPA

- Updated `src/renderer/packages/chatbridge/controller.ts` — added chess to `HARDCODED_FALLBACK_APPS` for offline resilience

- Ran `npm install` and `npm run build` in `apps/chess/` — produced `dist/index.html` + `dist/assets/index-*.js` (282 kB, 87 kB gzip)

- Verified `cd server && npx tsc --noEmit` — clean (no errors in server code)
- Verified `cd apps/chess && npx tsc --noEmit` — clean

- Committed: `feat(chess): add interactive chess app with react-chessboard and full postMessage protocol`

---

## Issues & Troubleshooting

- **Problem:** `Read` tool blocked for code discovery by the `cbm-code-discovery-gate` hook
  - **Cause:** Project hook requires codebase-memory-mcp tools to be used first for code discovery
  - **Fix:** Used `mcp__codebase-memory-mcp__search_graph` + `get_code_snippet` to locate the exact `getAnthropicTools` function, then used `Bash` cat to read full file contents

- **Problem:** `nvm` not available when running `pnpm run check` for frontend typecheck
  - **Cause:** `nvm` is shell-sourced, not available in non-interactive Bash invocations
  - **Fix:** Prefixed command with `source ~/.nvm/nvm.sh && nvm use 22 &&`

- **Problem:** Frontend typecheck (`pnpm run check`) reported pre-existing errors
  - **Cause:** Errors in upstream Chatbox fork files (`moonshot.ts`, `qwen.ts`, `openai-responses.ts`, `src/shared/providers/index.ts`) — not in any files we modified
  - **Fix:** Not our issue. Server and chess app both pass `tsc --noEmit` cleanly. Pre-existing errors documented.

- **Problem:** `pnpm run typecheck` script not found
  - **Cause:** The frontend script is `check`, not `typecheck`
  - **Fix:** Used `pnpm run check` instead

- **Problem:** `dist/` not committed to git
  - **Cause:** `.gitignore` globally ignores `dist/`
  - **Fix:** Expected behavior. The built dist exists locally and Express serves it. For Railway deployment, a build step will be needed in the Railway config.

- **Problem:** Tailwind CSS warnings during chess app build
  - **Cause:** `react-chessboard` or a dependency references Tailwind config that doesn't exist in the chess app
  - **Fix:** Benign warning only; the chess app uses inline styles and the build succeeds with correct output

---

## Decisions Made

- **`new Chess(game.fen())` on every move** instead of mutating the Chess instance in place. chess.js's `Chess` object is mutable; spreading `{...game}` creates a plain object (loses methods), and `setGame(game)` with the same reference bails out of React re-renders. Creating a new `Chess` from the current FEN is clean and guarantees re-renders.

- **Single-mount `useEffect` with refs** for the postMessage event listener. The event handler is defined inside the effect (runs once on mount) and accesses current game state via `gameRef.current` — avoiding stale closures without needing the effect to re-subscribe on every state change.

- **`onPieceDrop(sourceSquare, targetSquare)` positional API** for react-chessboard, matching the basic usage examples in the Context7 docs rather than the newer `options.onPieceDrop({ piece, sourceSquare, targetSquare })` form.

- **`/apps/chess` route before `/apps` catch-all** in Express. The generic `/apps` static route serves the source directory; adding a specific `/apps/chess` route pointing to `dist/` first ensures the built SPA is served correctly.

- **Chess dist built locally, not committed**. Keeps the repo clean. Railway deployment will need a `cd apps/chess && npm run build` step added to the build command.

- **Chess tools use `input_schema` in chatHandler, `parameters` in apps route/controller**. Per the SPEC and API contract rules: internal/client format uses `parameters`, Anthropic API calls use `input_schema`. This distinction is maintained consistently.

---

## Current State

**Working (M0–M4 complete):**
- Express backend with WebSocket streaming via Anthropic Claude Sonnet 4.6
- JWT authentication on WebSocket upgrade (hardcoded token for M0–M4)
- Full tool call loop: Claude calls tool → server sends `tool_call` to client → client forwards to iframe → iframe returns `tool_result` → Claude continues
- Test app (`apps/test-app/`) validates the protocol end-to-end
- Chess app (`apps/chess/`) — built and served at `/apps/chess/`
  - Interactive board with drag-and-drop
  - `start_game`, `make_move`, `get_board_state` tools wired to Claude
  - `state_update` sent after every move (user drag and LLM call)
  - `completion` sent on checkmate/stalemate/draw
  - Status bar with turn, check, game-over indicators

**Not yet done:**
- M5: Real JWT auth (register/login endpoints) — still using hardcoded dev token
- M6: Auth UI
- M7: Weather dashboard app
- M8: Spotify OAuth app
- M9: Error handling polish (circuit breaker, retry UI)
- M10: Automated tests
- M11: Railway deployment (chess app needs build step added)

---

## Next Steps

1. **M5 — Real auth endpoints**: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/refresh`, JWT middleware, bcrypt hashing. Add `POST /api/auth/demo` for friction-free grading.
2. **M6 — Auth UI**: Simple login/register form in the Chatbox frontend; store JWT in localStorage or httpOnly cookie.
3. **M7 — Weather app**: Build `apps/weather/` following the same postMessage protocol pattern. Tools: `get_forecast`, `get_current_weather`. No user auth, server-side API key.
4. **Add chess build step to Railway config**: Ensure `apps/chess && npm run build` runs before server starts in production.
5. **M8 — Spotify OAuth** (if time): Full popup OAuth flow, token storage in `oauth_tokens` table, `get_playlists` / `play_track` tools.
