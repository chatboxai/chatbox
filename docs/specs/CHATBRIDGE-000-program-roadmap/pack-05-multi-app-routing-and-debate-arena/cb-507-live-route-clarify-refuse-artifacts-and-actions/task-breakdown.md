# CB-507 Task Breakdown

## Story

- Story ID: CB-507
- Story Title: Live route clarify refuse artifacts and actions

## Execution Notes

- Treat this as visible product behavior, not only contract work.
- Complete the Pencil approval gate before changing route-decision UI.
- Keep artifact actions host-owned and replay-safe.

## Story Pack Alignment

- Higher-level pack objectives: O1, O2, O3
- Planned stories in this pack: CB-501, CB-502, CB-503, CB-504, CB-505,
  CB-506, CB-507
- Why this story set is cohesive: Pack 05 owns explainable multi-app routing;
  this backfill brings its clarify/refuse behavior into the real UI.
- Coverage check: this story mainly advances O1, O2, O3.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Produce the Pencil review packet for live clarify and refusal artifacts plus actionable choices. | must-have | no | Pencil review packet and approval gate |
| T002 | Wire route-decision artifacts into the live message-rendering path and persist their structured payload. | blocked-by:T001 | no | Renderer and integration tests |
| T003 | Connect clarify actions back into host-owned route and launch control with stale-action protection. | blocked-by:T002 | no | Interaction tests |
| T004 | Add accessibility, reload persistence, refusal, and degraded-action coverage. | blocked-by:T002,T003 | yes | pnpm test and manual smoke verification |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [x] Clarify/refusal artifact states are documented before code
- T002 tests:
  - [x] Ambiguous prompt renders a clarify artifact in live runtime
- T003 tests:
  - [x] Clarify action launches through host-owned state
- T004 tests:
  - [x] Refusal, stale actions, and reload persistence remain correct

## Completion Criteria

- [x] All must-have tasks complete
- [x] Acceptance criteria mapped to completed tasks
- [x] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
