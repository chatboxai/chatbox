# CB-302 Task Breakdown

## Story

- Story ID: CB-302
- Story Title: Chess runtime and legal move engine

## Execution Notes

- Keep tasks small, verifiable, and mapped to the host-owned contract.
- Do not jump to implementation before the public contract and failure mode are clear.
- Complete the Pencil review and approval gate before any UI coding work.
- Preserve existing Chatbox seams and avoid one-off prototypes.

## Story Pack Alignment

- Higher-level pack objectives: O1, O2
- Planned stories in this pack: CB-301, CB-302, CB-303, CB-304
- Why this story set is cohesive: it advances Pack 03 by solving one bounded part of the host/runtime contract.
- Coverage check: this story mainly advances O1, O2.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Create the Pencil review for the playable Chess board states and interaction patterns. | must-have | no | Pencil review packet and approval gate |
| T002 | Implement the Chess runtime with legal move validation and structured board state. | blocked-by:T001 | no | Runtime/unit tests |
| T003 | Bridge board updates into host state without bypassing lifecycle contracts. | blocked-by:T002 | yes | Integration tests with host/runtime bridge |
| T004 | Add move validation, error state, and keyboard/accessibility coverage. | blocked-by:T002,T003 | yes | pnpm test and smoke verification |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Legal/illegal move behavior
- T002 tests:
  - [ ] Board state propagation to host runtime
- T003 tests:
  - [ ] Runtime stability inside container lifecycle states

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
