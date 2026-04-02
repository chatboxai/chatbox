# CB-704 Task Breakdown

## Story

- Story ID: CB-704
- Story Title: Partner SDK, manifest validator, and local harness

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
| T001 | Define the validator and local harness scope based on the reviewed app contract. | must-have | no | Design and contract review |
| T002 | Implement manifest validation and representative bridge/lifecycle checks. | blocked-by:T001 | no | Validator tests |
| T003 | Create the mock/local host harness and partner sample flows. | blocked-by:T002 | yes | Integration tests with sample app |
| T004 | Document partner setup, auth expectations, completion rules, and debugging flow. | blocked-by:T002,T003 | yes | pnpm test where applicable plus docs review |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [x] Validator success/failure behavior
- T002 tests:
  - [x] Mock host harness flow coverage
- T003 tests:
  - [x] Partner sample app conformance tests

## Completion Criteria

- [x] All must-have tasks complete
- [x] Acceptance criteria mapped to completed tasks
- [x] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
