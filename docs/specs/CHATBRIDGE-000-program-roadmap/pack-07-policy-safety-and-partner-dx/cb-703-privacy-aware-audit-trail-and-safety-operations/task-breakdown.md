# CB-703 Task Breakdown

## Story

- Story ID: CB-703
- Story Title: Privacy-aware audit trail and safety operations

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
| T001 | Define audit event categories and retention/minimization rules. | must-have | no | Audit schema tests |
| T002 | Implement redaction/minimization in audit emission paths. | blocked-by:T001 | no | Redaction tests |
| T003 | Add explicit gating for exceptional forensic capture paths. | blocked-by:T001,T002 | yes | Permission/gating tests |
| T004 | Document the privacy posture and add regression coverage. | blocked-by:T002,T003 | yes | pnpm test |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Audit event shape coverage
- T002 tests:
  - [ ] Redaction behavior for sensitive fields
- T003 tests:
  - [ ] Exceptional capture gating behavior

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
