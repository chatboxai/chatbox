# CB-202 Task Breakdown

## Story

- Story ID: CB-202
- Story Title: App instance and event domain model

## Execution Notes

- Keep tasks small, verifiable, and mapped to the host-owned contract.
- Do not jump to implementation before the public contract and failure mode are clear.
- Expand visible UI scope only if implementation genuinely requires a surfaced state.
- Preserve existing Chatbox seams and avoid one-off prototypes.

## Story Pack Alignment

- Higher-level pack objectives: O2, O3
- Planned stories in this pack: CB-201, CB-202, CB-203, CB-204
- Why this story set is cohesive: it advances Pack 02 by solving one bounded part of the host/runtime contract.
- Coverage check: this story mainly advances O2, O3.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Define the appInstance and appEvent schema set with clear status transitions. | must-have | no | Domain model tests |
| T002 | Create storage and selector seams for instance/event reads and writes. | blocked-by:T001 | no | Integration tests for persistence and hydration |
| T003 | Document how lifecycle events map to renderer and orchestrator concerns. | blocked-by:T001 | yes | Spec review |
| T004 | Add transition and hydration regression coverage. | blocked-by:T002,T003 | no | pnpm test and pnpm check |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] State transition validation
- T002 tests:
  - [ ] Illegal lifecycle transition rejection
- T003 tests:
  - [ ] App instance serialization and hydration

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
