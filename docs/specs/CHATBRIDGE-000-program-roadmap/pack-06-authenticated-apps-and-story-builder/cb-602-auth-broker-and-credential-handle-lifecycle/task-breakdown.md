# CB-602 Task Breakdown

## Story

- Story ID: CB-602
- Story Title: Auth broker and credential-handle lifecycle

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
| T001 | Define the credential handle schema and lifecycle rules. | must-have | no | Schema and lifecycle tests |
| T002 | Implement broker flows for issue, refresh, revoke, and validate. | blocked-by:T001 | no | Integration tests |
| T003 | Connect handle validation to app-launch and resource-access paths. | blocked-by:T002 | yes | Host/runtime tests |
| T004 | Add failure-path and expiry regression coverage. | blocked-by:T002,T003 | yes | pnpm test and pnpm check |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Credential handle issuance and lookup
- T002 tests:
  - [ ] Refresh and expiry behavior
- T003 tests:
  - [ ] Revocation and invalid-handle rejection

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
