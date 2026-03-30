# CB-604 Task Breakdown

## Story

- Story ID: CB-604
- Story Title: Host-mediated resource proxy

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
| T001 | Define the resource proxy request/response contract and allowed action model. | must-have | no | Contract tests |
| T002 | Implement host-side authorization and resource mediation for approved actions. | blocked-by:T001 | no | Integration tests with mock provider |
| T003 | Connect Story Builder and future authenticated apps to the proxy path. | blocked-by:T002 | yes | Host/runtime integration tests |
| T004 | Add audit and failure-path coverage for denied or expired-resource access. | blocked-by:T002,T003 | yes | pnpm test |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Approved versus rejected resource actions
- T002 tests:
  - [ ] Invalid/expired handle rejection
- T003 tests:
  - [ ] Normalized result and audit behavior

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
