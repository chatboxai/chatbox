# Admin Panel & Trust and Safety Plan

**Branch:** `feat/admin-panel`
**Goal:** Build a simple admin panel for reviewing and approving/rejecting app registrations, and document the K-12 trust and safety strategy.

---

## Part 1: Admin Panel (Build)

### Step 1 — Add `GET /api/apps/all` endpoint

**Files:** `server/src/routes/apps.ts`

Add a new route `GET /api/apps/all` that uses `requireAuth` middleware and returns all app registrations regardless of status via `prisma.appRegistration.findMany()` (no `where` filter on status). Return the same response shape as `GET /api/apps` but include pending and rejected apps. The existing `GET /api/apps` stays unchanged — it remains unauthenticated and returns only approved apps. Place the new route before the `/:id` param routes to avoid TanStack Router-style path conflicts where `all` is interpreted as an `:id`.

**Edge cases:** If no apps exist, return `{ apps: [] }` not 404. Wrap the Prisma call in try/catch and return 500 on DB errors. Ensure the response includes the `status` field so the admin panel can display and filter by it.

---

### Step 2 — Create the admin page component

**Files:** `src/renderer/routes/admin/route.tsx` (create new)

Create a new route component following the TanStack Router file-based routing pattern used by existing routes like `src/renderer/routes/settings/route.tsx` and `src/renderer/routes/dev/route.tsx`. The component fetches all apps from `GET /api/apps/all` using the JWT from `useAuthStore((state) => state.token)` in an Authorization header. Display a Mantine `Table` with columns: Name, URL (truncated, linked), Description, Status (color-coded `Badge`), and Actions. Each row has an expandable section (Mantine `Collapse` or `Accordion`) showing the app's tool schemas as formatted JSON. Approve and Reject buttons call `PATCH /api/apps/:id/status` with the appropriate status string, then refetch the list. Show a Mantine `Notification` on success or error after each action. Use `useEffect` + `fetch` for data loading (matching existing patterns), or TanStack Query if the project already uses it for server state.

**Edge cases:** Disable Approve button if status is already `approved`; disable Reject if already `rejected`. Handle network errors gracefully with a user-visible error state. Show a loading skeleton while fetching. If the token is missing (user not logged in), redirect to login or show an "unauthorized" message.

---

### Step 3 — Add routing

**Files:** `src/renderer/routes/admin/route.tsx` (same file from Step 2)

TanStack Router's file-based routing auto-generates the `/admin` route from the directory structure. Ensure the file exports a `Route` created with `createFileRoute('/admin')` following the same pattern as `src/renderer/routes/dev/route.tsx`. The route should be accessible to any authenticated user — no role-based gating for the sprint. If the user is not authenticated (`useAuthStore` returns no token), render a message directing them to log in rather than the admin UI.

**Edge cases:** If TanStack Router requires the route tree to be regenerated, run `pnpm run dev` or the route generation command to pick up the new file. Verify the route appears in the generated `routeTree.gen.ts`.

---

### Step 4 — Add a link to the admin panel

**Files:** `src/renderer/Sidebar.tsx`

Add a Mantine `NavLink` in the sidebar navigation between the existing "Settings" and "About" links. Use a Tabler icon like `IconShieldCheck` or `IconSettings2` for consistency with other nav items. The link navigates to `/admin` using the same navigation pattern as the other sidebar links (e.g., `navigate({ to: '/admin' })`). Only show the link when the user is authenticated (`useAuthStore` check).

**Edge cases:** On mobile/narrow viewports, ensure the link doesn't break the sidebar layout. The link label should be "App Review" or "Admin" — keep it short to match the existing nav style.

---

### Step 5 — Add tests

**Files:** `server/src/__tests__/apps.test.ts`

Add a new `describe('GET /api/apps/all', ...)` block following the existing test patterns in this file (Vitest + supertest, `beforeAll` creates a test user and gets an auth token). Test cases: (1) returns 401 without an auth token; (2) with auth, returns apps of all statuses — seed one pending, one approved, and one rejected app in the test setup, then assert the response contains all three; (3) response includes the `status` field on each app object; (4) response shape matches the expected contract (id, name, url, description, tools, status). Clean up seeded test apps in `afterAll`.

**Edge cases:** Ensure test isolation — delete any apps created during this test block so they don't leak into other test suites. Use unique app names/URLs to avoid conflicts with the existing seed data.

---

## Part 2: Trust & Safety Documentation (Document)

### Step 6 — Create `chatbridge/docs/TRUST_AND_SAFETY.md`

**Files:** `chatbridge/docs/TRUST_AND_SAFETY.md` (create new)

Write a document covering the K-12 trust and safety strategy with the following sections. Target 400-600 words, written for a technical reviewer evaluating child safety posture.

**Section outline:**

1. **Sandbox Isolation** — Third-party apps run inside iframes with `sandbox="allow-scripts"` and no `allow-same-origin`. This browser-enforced boundary prevents apps from accessing the parent page's DOM, cookies, localStorage, or session tokens. All communication flows through a typed `postMessage` protocol with validated message types — the app cannot inject arbitrary content into the platform. Reference: `ChatBridgeFrame.tsx` implements origin validation on every received message, rejecting anything from unexpected sources.

2. **Data Minimization** — Apps receive only the structured parameters defined in their tool schemas (e.g., `{ from: "e2", to: "e4" }` for a chess move). They never see conversation history, user email, other apps' data, or the platform JWT. State updates from apps flow through the platform's system prompt injection — the platform controls what context the LLM receives. This ensures no app can exfiltrate student data or inject content into another app's context. Reference: postMessage protocol in `SPEC.md`.

3. **App Vetting Gate** — Every new app registration enters a `pending` state and is invisible to users until an admin explicitly approves it via `PATCH /api/apps/:id/status`. The admin panel (Step 2) provides visibility into pending registrations, tool schemas, and app URLs. In production, the review process should include: verifying HTTPS-only URLs, inspecting tool schemas for overly broad parameter types, and testing the app in a sandboxed preview environment. Reference: `apps.ts` POST/PATCH endpoints.

4. **Content Filtering via LLM** — All app output passes through Claude before reaching the student. App `state_update` messages are injected into the system prompt context, not displayed directly. Claude's built-in safety training acts as a content filter — if an app returns harmful, inappropriate, or misleading content, Claude will refuse to relay it or will flag it in its response. This makes the LLM the last line of defense between third-party content and the student.

5. **Runtime Protections** — Multiple layers limit blast radius at runtime: a circuit breaker removes an app's tools after 3 consecutive failures (preventing a broken app from degrading the chat experience), per-user and per-app rate limiting caps tool invocations at 30/minute, iframe load timeout (5s) and tool call timeout (10s) prevent hung apps from blocking the conversation, and error results are injected as normal tool results so the LLM can explain failures conversationally. Reference: `chatBridgeStore.ts` (circuit breaker), `rateLimit.ts` (rate limiting middleware).

6. **What's Not Built Yet (Production Roadmap)** — Acknowledge current gaps honestly: no role-based admin access (any authenticated user can access the admin panel), no per-app CSP header enforcement, no automated content scanning of iframe-rendered content, no audit logging of admin approval/rejection actions, and no automated tool schema validation beyond JSON structure. These are the next priorities for a production K-12 deployment. Frame as a roadmap, not missing features — the current implementation provides defense-in-depth through sandbox isolation, data minimization, and LLM content filtering, with the admin review gate as the human checkpoint.
