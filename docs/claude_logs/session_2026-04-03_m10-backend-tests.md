# Session Log: Milestone 10 — Backend Test Suite

**Date:** 2026-04-03
**Duration:** ~45 minutes
**Focus:** Add Jest + supertest test coverage to the Express backend (M10 acceptance criteria)

---

## What Got Done

- Installed `jest`, `ts-jest`, `@types/jest`, `supertest`, `@types/supertest` as dev dependencies in `server/`
- Created `server/jest.config.js` — ts-jest config with 15s timeout, `forceExit`, `detectOpenHandles`, `setupFiles` pointing at `envSetup.ts`
- Added `test` and `test:watch` scripts to `server/package.json`
- Created `server/src/__tests__/envSetup.ts` — loads `.env` via dotenv, then overrides `JWT_SECRET` and `ANTHROPIC_API_KEY` with known test values before any module imports run
- Created `server/src/__tests__/helpers.ts` — `generateToken()`, `generateExpiredToken()`, `cleanupTestUsers()`, `uniqueEmail()` shared utilities
- Modified `server/src/index.ts` — added `export { app, server }` and wrapped `start()` call in `if (require.main === module)` so the server does not auto-listen when imported by tests
- Modified `server/src/middleware/rateLimit.ts` — added `skip: () => isTest` to both `authLimiter` and `apiLimiter` to prevent the 10 req/min auth limit from blocking tests
- Modified `server/src/routes/oauth.ts` — called `.unref()` on the `setInterval` so it does not keep Jest workers open after tests complete
- Created `server/src/__tests__/auth.test.ts` — 11 tests: register (201), duplicate email (409), short password (400), invalid email (400), login (200), wrong password (401), unknown email (401), refresh (200), invalid token (401), no header (401), demo endpoint (200/503)
- Created `server/src/__tests__/middleware.test.ts` — 6 tests: valid JWT passes, no header (401), invalid JWT (401), wrong secret (401), expired JWT (401), bare `Bearer ` header (401)
- Created `server/src/__tests__/apps.test.ts` — 5 tests: returns array, chess + weather + spotify present, each app has required fields, tools have required fields, all status `approved`
- Created `server/src/__tests__/conversations.test.ts` — 8 tests: create (201), default title, list (200), get by ID (200), 404 for missing, delete (204), auth required on all endpoints
- Created `server/src/__tests__/ws.test.ts` — 4 tests: valid JWT connects, no token rejected (HTTP 401), invalid JWT rejected (401), expired JWT rejected (401)
- All 36 tests pass; `npx tsc --noEmit` is clean
- Committed as `test(server): add auth, middleware, apps, conversations, and WebSocket test suites` on branch `feat/m10-tests`

---

## Issues & Troubleshooting

### 1. WS rejection tests: "done called multiple times"

- **Problem:** The three negative WebSocket tests (no token, invalid JWT, expired JWT) failed with "Expected done to be called once, but it was called multiple times."
- **Cause:** When the server sends HTTP 401 (rather than 101 WebSocket upgrade), the `ws` client emits *both* `unexpected-response` and `error` events. Both handlers called `done()`.
- **Fix:** Introduced a `onceDone()` guard wrapper that uses a `let called = false` flag, ensuring `done` is invoked exactly once regardless of which events fire.

### 2. Open handles warning — `setInterval` in `oauth.ts`

- **Problem:** Jest reported 5 open handles pointing at the `setInterval` in `src/routes/oauth.ts`. Since every test file imports `index.ts` (which imports `oauth.ts`), all workers were keeping this interval alive.
- **Cause:** Node.js `setInterval` keeps the event loop alive unless explicitly `unref()`d.
- **Fix:** Captured the return value of `setInterval` and called `.unref()` on it. The interval still runs in production (where the event loop stays alive anyway) but no longer prevents Jest from exiting cleanly.

### 3. ts-jest deprecation warning for `globals` config

- **Problem:** Initial `jest.config.js` used `globals: { 'ts-jest': { tsconfig } }` which emits a deprecation warning in ts-jest v29+.
- **Cause:** ts-jest moved configuration from `globals` to the `transform` array syntax.
- **Fix:** Switched `jest.config.js` to use `transform: { '^.+\\.ts$': ['ts-jest', { tsconfig }] }`.

### 4. Rate limiter blocking auth tests

- **Problem:** The auth endpoint has a 10 req/min rate limit. Running the full test suite could hit this, causing spurious 429 responses in CI or on repeated local runs.
- **Cause:** `express-rate-limit` tracks by IP; supertest uses `127.0.0.1` for all requests.
- **Fix:** Added `skip: () => process.env.NODE_ENV === 'test'` to both limiters. `envSetup.ts` sets `NODE_ENV=test` before any modules load.

### 5. `start()` auto-called on import

- **Problem:** `index.ts` ended with `start()` at the top level, meaning importing `app` from `index.ts` in tests would attempt to connect to Postgres and `server.listen()`.
- **Cause:** Original design assumed `index.ts` was always the entry point.
- **Fix:** Wrapped the call in `if (require.main === module) { void start() }`. Tests get the configured `app` and `server` without any DB connection or port binding (except `ws.test.ts` which explicitly calls `server.listen(0)` for a random test port).

---

## Decisions Made

- **Same database as dev (not a separate test DB):** Tests run against the real Postgres using `DATABASE_URL` from `.env`. Test data is isolated by using `@jest.test` email suffix and cleaned up in `afterAll`. This avoids the complexity of creating a `chatbridge_test` database or running `prisma db push` in a `globalSetup` file, and is acceptable for a one-week sprint.
- **`setupFiles` (not `globalSetup`) for env vars:** `setupFiles` runs inside each Jest worker, which means `process.env` assignments take effect before test file modules are imported. `globalSetup` runs in a separate process where env var changes do not propagate to workers. This was the key to making `JWT_SECRET` override work reliably.
- **Fake userId for middleware/WS tests:** `requireAuth` and the WS upgrade handler only verify the JWT signature — they do not look up the user in Postgres. So middleware and WS tests use a hardcoded fake UUID, avoiding any DB setup for those suites.
- **`onceDone()` guard instead of removing the error handler:** Keeping both `unexpected-response` and `error` handlers ensures the test finishes promptly even if the OS delivers events in a different order. The guard is minimal and self-documenting.
- **`unref()` rather than clearing the interval:** The OAuth CSRF cleanup interval is a legitimate feature in production. `unref()` makes it non-blocking for the process exit lifecycle without removing the functionality.

---

## Current State

- **M0–M9:** Complete (backend scaffold, plugin system, chess, auth, weather, Spotify OAuth, error handling / circuit breaker).
- **M10:** Complete. `cd server && npm test` → 36 tests across 5 suites, all green. `npx tsc --noEmit` clean.
- **Branch:** `feat/m10-tests` (not yet merged to `main`).
- **Deployed:** Railway deployment from `main` (M9 code). M10 not yet merged/deployed.

---

## Next Steps

1. **Merge `feat/m10-tests` → `main`** via MR/PR, confirm Railway redeploy succeeds.
2. **M11 — Final polish and deployment verification:** Confirm all three apps (chess, weather, Spotify) work on the deployed URL. Fix any Railway-specific issues (CORS, WebSocket wss:// vs ws://).
3. **Record demo video (Day 6 task):** Chess demo + weather demo + Spotify OAuth + architecture walkthrough + `generation.ts` code walkthrough. 3–5 minutes.
4. **Write `chatbridge/docs/COST_ANALYSIS.md`:** Pull token usage from Anthropic console dashboard, fill in the projection table from `IMPLEMENTATION_PLAN.md`.
5. **Social post:** LinkedIn or X post with screenshots, deployed link, @GauntletAI tag.
6. **README polish:** Setup guide, API endpoints, plugin development docs, deployed link.
