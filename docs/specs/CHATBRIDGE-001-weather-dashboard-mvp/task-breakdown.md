# CHATBRIDGE-001 Task Breakdown

## Story

- Story ID: CHATBRIDGE-001
- Story Title: Weather Dashboard MVP

## Execution Notes

- Treat this as a completion-ready MVP track, not as a loose brainstorm.
- Keep the app public and no-auth for the whole first release.
- Do not implement visible UI until the per-story spec and Pencil review are
  complete.
- Use host-owned lifecycle, state, and memory rules for every story.
- Refresh `src/renderer/packages/initial_data.ts` at implementation completion
  if the shipped feature changes seeded examples.

## Recommended Story Order

1. `WD-101` because location clarity is the first trust boundary.
2. `WD-102` because all downstream behavior depends on a normalized snapshot.
3. `WD-103` because the dashboard shell should consume normalized host state,
   not raw provider output.
4. `WD-104` because follow-up continuity depends on launch and render behavior
   already working.
5. `WD-105` because degraded and completion behavior should harden the finished
   vertical slice rather than distort the earlier stories.

## Tasks

| Task ID | User Story | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| WD-101 | As a user, I can ask for weather and get a clear location-selection or clarification flow instead of a silent guess. | must-have | no | intent-routing and clarification tests |
| WD-102 | As the host, I can fetch public forecast data and normalize it into one trusted snapshot shape with freshness metadata. | blocked-by:WD-101 | partial | adapter and normalization tests |
| WD-103 | As a user, I can see a readable in-thread dashboard with current conditions, short forecast, and status states. | blocked-by:WD-102 | no | render-state tests plus Pencil approval before UI code |
| WD-104 | As a user, I can refresh the forecast, change location, and ask follow-up questions without losing the active weather context. | blocked-by:WD-103 | no | refresh, continuity, and follow-up integration tests |
| WD-105 | As support and QA, I can observe stale-data, provider-failure, and close-summary behavior so the app is safe to ship. | blocked-by:WD-104 | no | degraded-path, completion, and regression tests |

Dependency values:

- `must-have`
- `blocked-by:<task-id>`
- `optional`

Parallelizable values:

- `yes`
- `no`
- `partial`

## Story Details

### WD-101 - Intent Routing and Location Clarification

- Goal:
  establish when the host should launch the weather app and when it must ask a
  follow-up question first
- Acceptance focus:
  routing confidence, ambiguous-city handling, unit selection defaults,
  chat-only fallback for irrelevant prompts

### WD-102 - Provider Adapter and Snapshot Normalization

- Goal:
  create a host-owned weather snapshot contract that hides provider-specific
  response details
- Acceptance focus:
  current, hourly, and daily data normalization; alert mapping; freshness and
  stale calculations

### WD-103 - Dashboard Shell and Rendering States

- Goal:
  render the normalized snapshot inside the host-owned app container
- Acceptance focus:
  loading, fresh, partial-data, and degraded views; location label clarity;
  explicit freshness text

### WD-104 - Refresh, Change Location, and Follow-Up Continuity

- Goal:
  prove the weather app behaves like an app session, not a static one-off card
- Acceptance focus:
  refresh idempotency, location swaps, resume behavior, and assistant follow-up
  answers grounded in the active snapshot

### WD-105 - Degraded Behavior, Completion, and Regression Coverage

- Goal:
  make the vertical slice ship-ready
- Acceptance focus:
  provider failures, stale-session reopen behavior, explicit close summary,
  structured telemetry, and seeded example review

## TDD Mapping

- WD-101:
  routing classifier tests, clarification prompt tests, irrelevant-intent tests
- WD-102:
  normalization tests, freshness budget tests, partial payload tests
- WD-103:
  dashboard render-state tests, accessibility text assertions, loading and error
  visual-state checks
- WD-104:
  integration coverage for refresh, change location, and follow-up continuity
- WD-105:
  degraded path, close summary, telemetry, and end-to-end regression coverage

## Completion Criteria

- [ ] The MVP is decomposed into five ordered user stories with clear
      dependencies.
- [ ] Each story has a concrete user value and validation target.
- [ ] The packet defines what "complete" means for routing, data, UI,
      continuity, and degraded behavior.
- [ ] The first implementation story is obvious without reopening scope.

## Recommended First Story

`WD-101 - Intent Routing and Location Clarification`
