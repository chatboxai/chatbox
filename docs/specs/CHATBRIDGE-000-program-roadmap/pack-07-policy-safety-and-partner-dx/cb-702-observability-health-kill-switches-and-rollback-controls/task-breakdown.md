# CB-702 Task Breakdown

## Story

- Story ID: CB-702
- Story Title: Observability, health, kill switches, and rollback controls

## Execution Notes

- Keep tasks small, verifiable, and mapped to the host-owned contract.
- Do not jump to implementation before the public contract and failure mode are clear.
- Expand visible UI scope only if implementation genuinely requires a surfaced state.
- Preserve existing Chatbox seams and avoid one-off prototypes.

## Story Pack Alignment

- Higher-level pack objectives: O3, O5
- Planned stories in this pack: CB-701, CB-702, CB-703, CB-704
- Why this story set is cohesive: it advances Pack 07 by solving one bounded part of the host/runtime contract.
- Coverage check: this story mainly advances O3, O5.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Define health, telemetry, and kill-switch contract shapes. | must-have | no | Schema/unit tests |
| T002 | Instrument host lifecycle paths with normalized observability events. | blocked-by:T001 | no | Integration tests |
| T003 | Implement registry/version disablement behavior for new and active sessions. | blocked-by:T002 | yes | Disablement tests |
| T004 | Document rollback expectations and add regression coverage. | blocked-by:T002,T003 | yes | pnpm test |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [x] Health event emission coverage
- T002 tests:
  - [x] Kill-switch behavior for new launches
- T003 tests:
  - [x] Disablement behavior for active sessions

## Completion Criteria

- [x] All must-have tasks complete
- [x] Acceptance criteria mapped to completed tasks
- [x] Tests added and passing for each implemented task
- [x] Deferred tasks documented with rationale

Deferred tasks:

- none; the story remains intentionally scoped to contracts, runtime gating, and
  observability without expanding into an operator dashboard UI.
