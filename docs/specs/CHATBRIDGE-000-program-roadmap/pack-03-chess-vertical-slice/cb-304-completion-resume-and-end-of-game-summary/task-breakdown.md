# CB-304 Task Breakdown

## Story

- Story ID: CB-304
- Story Title: Completion, resume, and end-of-game summary

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
| T001 | Define the Chess completion and resume payload contract. | must-have | no | Completion contract tests |
| T002 | Implement host handling for end-of-game, interrupted, and resumed states. | blocked-by:T001 | no | Lifecycle integration tests |
| T003 | Create the approved completion/resume UI states in the timeline if new visible surfaces are needed. | blocked-by:T001,T002 | yes | Pencil gate if UI changes are introduced plus renderer tests |
| T004 | Add post-game follow-up coverage so later assistant turns can discuss the outcome. | blocked-by:T002,T003 | yes | pnpm test and model-context tests |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Completion event processing
- T002 tests:
  - [ ] Interrupted/resume behavior
- T003 tests:
  - [ ] Later-turn post-game context retrieval

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
