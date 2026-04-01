# CB-404 Task Breakdown

## Story

- Story ID: CB-404
- Story Title: Degraded completion and recovery UX

## Execution Notes

- Keep tasks small, verifiable, and mapped to the host-owned contract.
- Do not jump to implementation before the public contract and failure mode are clear.
- Complete the Pencil review and approval gate before any UI coding work.
- Preserve existing Chatbox seams and avoid one-off prototypes.

## Story Pack Alignment

- Higher-level pack objectives: O1, O2, O3
- Planned stories in this pack: CB-401, CB-402, CB-403, CB-404
- Why this story set is cohesive: it advances Pack 04 by solving one bounded part of the host/runtime contract.
- Coverage check: this story mainly advances O1, O2, O3.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Create the Pencil review packet for degraded completion and recovery states. | must-have | no | Pencil review packet and approval gate |
| T002 | Model degraded completion states and recovery actions in the host runtime. | blocked-by:T001 | no | Lifecycle tests |
| T003 | Implement the approved recovery UI in the timeline/app container surface. | blocked-by:T001,T002 | no | Renderer and accessibility tests |
| T004 | Add retry/resume/fallback regression coverage and live seed inspection coverage. | blocked-by:T002,T003 | yes | pnpm test and pnpm check |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [x] Invalid/missing completion fallback behavior
- T002 tests:
  - [x] Renderer state coverage for degraded completion
- T003 tests:
  - [x] Recovery action accessibility coverage
- T004 tests:
  - [x] Live seed degraded recovery catalog coverage

## Completion Criteria

- [x] All must-have tasks complete
- [x] Acceptance criteria mapped to completed tasks
- [x] Tests added and passing for each implemented task
- [x] Deferred tasks documented with rationale

Deferred tasks:
- none
