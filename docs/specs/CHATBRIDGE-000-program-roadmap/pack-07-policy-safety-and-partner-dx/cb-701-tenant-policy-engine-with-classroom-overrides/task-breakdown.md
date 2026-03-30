# CB-701 Task Breakdown

## Story

- Story ID: CB-701
- Story Title: Tenant policy engine with classroom overrides

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
| T001 | Define the tenant/teacher/classroom policy schema and precedence rules. | must-have | no | Policy unit tests |
| T002 | Implement precedence resolution and fail-closed behavior. | blocked-by:T001 | no | Integration tests |
| T003 | Connect policy outputs to app eligibility and routing paths. | blocked-by:T002 | yes | Routing tests |
| T004 | Add explicit coverage for stale-policy and override edge cases. | blocked-by:T002,T003 | yes | pnpm test |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] District deny precedence behavior
- T002 tests:
  - [ ] Teacher/classroom narrowing behavior
- T003 tests:
  - [ ] Stale-policy fail-closed tests

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
