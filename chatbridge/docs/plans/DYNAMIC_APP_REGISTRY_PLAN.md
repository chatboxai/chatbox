# Dynamic App Registration Plan

**Branch:** `feat/dynamic-app-registry`
**Goal:** Replace the hardcoded app array in `GET /api/apps` with database-backed queries so third-party developers can register apps via API.

---

## Step 1 — Seed existing apps into the database

**Files:** `server/prisma/seed.ts` (already done)

The seed file already upserts test-app, chess, weather, and spotify into `AppRegistration` with `status: "approved"` and deterministic IDs (lines 30-183). No changes needed here. Before switching the GET endpoint, run `npm run seed` on any environment that hasn't been seeded yet to avoid returning an empty array.

**Edge cases:** If the seed has never been run on a given database, the GET switch in Step 2 will return `[]` instead of the four apps. The frontend `controller.ts` (line 160) already falls back to `HARDCODED_FALLBACK_APPS` when the array is empty, so this is safe but undesirable. Document "run seed first" in the migration notes.

---

## Step 2 — Update `GET /api/apps` to query the database

**Files:** `server/src/routes/apps.ts` (lines 29-166)

Replace the hardcoded `router.get('/')` handler with a Prisma query: `prisma.appRegistration.findMany({ where: { status: 'approved' } })`. Map the result so the response shape stays identical — each app object must have `id`, `name`, `url`, `description`, `tools` (renamed from `toolSchemas`), and `status`. The Spotify app also needs `authRequired` and `authProvider` fields; since those aren't in the Prisma schema, either (a) add nullable `auth_required`/`auth_provider` columns via a migration and seed them, or (b) derive them from a convention (e.g., if the app has an OAuth token provider name stored elsewhere). Option (a) is cleaner — add a small migration.

**Response shape contract (must not change):**
```ts
{
  id: string
  name: string
  url: string
  description: string
  tools: Array<{ name: string; description: string; parameters: object }>
  status: string
  authRequired?: boolean   // only Spotify currently
  authProvider?: string    // only Spotify currently
}
```

**Edge cases:** The current endpoint has no auth (`_req` is unused). Keep it unauthenticated so the frontend can load the registry before login. Wrap the Prisma call in try/catch and return 500 on DB errors instead of crashing.

---

## Step 3 — Verify `POST /api/apps/register` works end-to-end

**Files:** `server/src/routes/apps.ts` (lines 168-190)

This endpoint already exists and works: it validates with `RegisterAppSchema`, inserts via Prisma with `status: "pending"`, and returns `{ id, status }`. No code changes needed. Verify it by running the test added in Step 6.

**Edge cases:** Currently there's no duplicate-name check. Two apps with the same name can be registered. This is acceptable for the sprint — admin review (Step 4) is the gate. If desired later, add a unique constraint on `(name, url)`.

---

## Step 4 — Verify `PATCH /api/apps/:id/status` works end-to-end

**Files:** `server/src/routes/apps.ts` (lines 192-215)

This endpoint also already exists: validates status enum, checks the app exists (404 if not), updates via Prisma. No code changes needed. For the sprint, any authenticated user can call it (no admin role check). Verify via tests in Step 6.

**Edge cases:** No transition validation (e.g., can go from "rejected" back to "approved"). Acceptable for sprint scope.

---

## Step 5 — Confirm frontend `controller.ts` compatibility

**Files:** `src/renderer/packages/chatbridge/controller.ts` (lines 145-168)

`loadRegistry()` already fetches `GET /api/apps` and handles both raw arrays and `{ apps: [...] }` wrappers (line 159-160). It also falls back to `HARDCODED_FALLBACK_APPS` on error. The only thing to verify is that the response shape from Step 2 matches `PluginManifest` — specifically that `tools` (not `toolSchemas`) is the field name in the response, and that each tool has `name`, `description`, `parameters`. If the Prisma query returns `toolSchemas` as the field name, rename it to `tools` in the route handler's map.

**No code changes expected** unless the field name mapping is off.

---

## Step 6 — Update and add tests

**Files:** `server/src/__tests__/apps.test.ts`

The existing test file (5 tests) validates GET returns an array of approved apps with the right shape. These tests will continue to pass after Step 2 as long as the seed has run. Add the following new test cases:

1. **POST /api/apps/register returns 201 with pending status** — Send a valid payload with auth token, assert `status === 201` and `body.status === "pending"`.
2. **POST /api/apps/register returns 400 for missing fields** — Send `{}`, assert 400.
3. **POST /api/apps/register returns 401 without auth** — No Authorization header, assert 401.
4. **GET /api/apps excludes pending apps** — Register a new app (pending), then GET and assert it's not in the list.
5. **PATCH /api/apps/:id/status updates to approved** — Register an app, PATCH to approved, GET and assert it appears.
6. **PATCH /api/apps/:id/status returns 404 for unknown ID** — PATCH a random UUID, assert 404.

Use the existing `helpers.ts` for auth token generation. Each test should clean up created records or rely on test transaction rollback.

---

## Migration checklist

- [ ] Run `npm run seed` on local and deployed databases before deploying the GET change
- [ ] If adding `authRequired`/`authProvider` columns: create migration, update seed, deploy migration before code
- [ ] Verify `GET /api/apps` returns the same 4 apps after the switch (compare response snapshots)
- [ ] Run full test suite: `cd server && npm test`
- [ ] Verify frontend loads apps from the database (check browser network tab for `/api/apps` response)
