# CB-503 Task Breakdown

## Story

- Story ID: CB-503
- Story Title: Debate Arena flagship app

## Execution Notes

- Keep tasks small, verifiable, and mapped to the host-owned contract.
- Do not jump to implementation before the public contract and failure mode are clear.
- Complete the Pencil review and approval gate before any UI coding work.
- Preserve existing Chatbox seams and avoid one-off prototypes.

## Story Pack Alignment

- Higher-level pack objectives: O1, O3
- Planned stories in this pack: CB-501, CB-502, CB-503, CB-504
- Why this story set is cohesive: it advances Pack 05 by solving one bounded part of the host/runtime contract.
- Coverage check: this story mainly advances O1, O3.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Create the Pencil review packet for Debate Arena setup, active, and completion states. | must-have | no | Pencil review packet and approval gate |
| T002 | Implement the Debate Arena runtime and structured workflow state. | blocked-by:T001 | no | Runtime tests |
| T003 | Integrate host lifecycle, completion, and summary normalization paths. | blocked-by:T002 | yes | Integration tests with host/runtime flow |
| T004 | Add accessibility, moderation-state, and end-to-end chat continuity coverage. | blocked-by:T002,T003 | yes | pnpm test and smoke verification |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Debate setup and turn progression
- T002 tests:
  - [ ] Lifecycle integration with host runtime
- T003 tests:
  - [ ] Completion summary normalization coverage

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
