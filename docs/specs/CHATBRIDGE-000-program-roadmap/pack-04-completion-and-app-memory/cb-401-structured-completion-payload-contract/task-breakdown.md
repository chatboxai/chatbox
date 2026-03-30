# CB-401 Task Breakdown

## Story

- Story ID: CB-401
- Story Title: Structured completion payload contract

## Execution Notes

- Keep tasks small, verifiable, and mapped to the host-owned contract.
- Do not jump to implementation before the public contract and failure mode are clear.
- Expand visible UI scope only if implementation genuinely requires a surfaced state.
- Preserve existing Chatbox seams and avoid one-off prototypes.

## Story Pack Alignment

- Higher-level pack objectives: O1, O2, O3
- Planned stories in this pack: CB-401, CB-402, CB-403, CB-404
- Why this story set is cohesive: it advances Pack 04 by solving one bounded part of the host/runtime contract.
- Coverage check: this story mainly advances O1, O2, O3.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Define the shared completion payload schema for success, interruption, and failure. | must-have | no | Schema contract tests |
| T002 | Integrate payload validation into host lifecycle handling. | blocked-by:T001 | no | Integration tests with mock app completions |
| T003 | Document completion semantics for app authors and host/runtime maintainers. | blocked-by:T001 | yes | Spec review |
| T004 | Add cross-app compatibility regression coverage. | blocked-by:T002,T003 | yes | pnpm test |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Completion payload parse and validation tests
- T002 tests:
  - [ ] Missing/invalid completion rejection behavior
- T003 tests:
  - [ ] Compatibility coverage across app types

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
