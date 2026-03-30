# CB-501 Task Breakdown

## Story

- Story ID: CB-501
- Story Title: Reviewed app discovery and eligibility filtering

## Execution Notes

- Keep tasks small, verifiable, and mapped to the host-owned contract.
- Do not jump to implementation before the public contract and failure mode are clear.
- Expand visible UI scope only if implementation genuinely requires a surfaced state.
- Preserve existing Chatbox seams and avoid one-off prototypes.

## Story Pack Alignment

- Higher-level pack objectives: O1, O3
- Planned stories in this pack: CB-501, CB-502, CB-503, CB-504
- Why this story set is cohesive: it advances Pack 05 by solving one bounded part of the host/runtime contract.
- Coverage check: this story mainly advances O1, O3.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Define the eligibility input and output contract for the router. | must-have | no | Unit tests for selector contract |
| T002 | Implement filtering based on reviewed status and context-aware availability. | blocked-by:T001 | no | Integration tests with sample app catalog |
| T003 | Add reason-code or debug metadata for ineligible apps. | blocked-by:T002 | yes | Tests for policy/debug outputs |
| T004 | Wire the filtered candidate list into routing entrypoints. | blocked-by:T002,T003 | no | pnpm test and targeted routing tests |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Eligibility filtering by reviewed status and context
- T002 tests:
  - [ ] Reason-code coverage for ineligible apps
- T003 tests:
  - [ ] Router candidate list behavior

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
