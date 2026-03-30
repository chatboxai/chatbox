# CB-403 Task Breakdown

## Story

- Story ID: CB-403
- Story Title: Active app context injection for later turns

## Execution Notes

- Keep tasks small, verifiable, and mapped to the host-owned contract.
- Do not jump to implementation before the public contract and failure mode are clear.
- Expand visible UI scope only if implementation genuinely requires a surfaced state.
- Preserve existing Chatbox seams and avoid one-off prototypes.

## Story Pack Alignment

- Higher-level pack objectives: O1, O2, O3
- Planned stories in this pack: CB-401, CB-402, CB-403, CB-404
- Why this story set is cohesive: it advances Pack 04 by solving one bounded part of the host/runtime contract.
- Coverage check: this story mainly advances O1, O2, O3.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Define the selection rules for active, recent, and irrelevant app context. | must-have | no | Context selection tests |
| T002 | Integrate host-approved app summaries into message assembly. | blocked-by:T001 | no | Integration tests with chat follow-up turns |
| T003 | Implement stale/missing-context fallback paths. | blocked-by:T002 | yes | Edge-case tests |
| T004 | Document the precedence rules between app context and ordinary conversation context. | blocked-by:T001,T002,T003 | yes | pnpm test |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Active app context selection
- T002 tests:
  - [ ] Recent-but-not-active app continuity behavior
- T003 tests:
  - [ ] Stale context fallback behavior

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
