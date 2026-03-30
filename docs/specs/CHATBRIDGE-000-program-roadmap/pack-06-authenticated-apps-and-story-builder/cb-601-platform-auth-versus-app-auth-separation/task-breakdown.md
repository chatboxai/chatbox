# CB-601 Task Breakdown

## Story

- Story ID: CB-601
- Story Title: Platform auth versus app auth separation

## Execution Notes

- Keep tasks small, verifiable, and mapped to the host-owned contract.
- Do not jump to implementation before the public contract and failure mode are clear.
- Expand visible UI scope only if implementation genuinely requires a surfaced state.
- Preserve existing Chatbox seams and avoid one-off prototypes.

## Story Pack Alignment

- Higher-level pack objectives: O2, O4
- Planned stories in this pack: CB-601, CB-602, CB-603, CB-604
- Why this story set is cohesive: it advances Pack 06 by solving one bounded part of the host/runtime contract.
- Coverage check: this story mainly advances O2, O4.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Define the separate domain model for platform auth and app auth grants. | must-have | no | Domain model tests |
| T002 | Map existing remote/token patterns onto the new split without breaking platform auth. | blocked-by:T001 | no | Integration tests |
| T003 | Document ownership, lifecycle, and revocation boundaries for app grants. | blocked-by:T001 | yes | Spec review |
| T004 | Add regression coverage proving the two auth layers remain separate. | blocked-by:T002,T003 | yes | pnpm test |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Domain-model tests for separate auth records
- T002 tests:
  - [ ] Grant lookup and session lookup separation coverage
- T003 tests:
  - [ ] No cross-contamination between platform tokens and app grants

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
