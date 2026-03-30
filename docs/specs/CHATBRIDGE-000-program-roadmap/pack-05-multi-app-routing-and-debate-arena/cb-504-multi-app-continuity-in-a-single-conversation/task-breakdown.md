# CB-504 Task Breakdown

## Story

- Story ID: CB-504
- Story Title: Multi-app continuity in a single conversation

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
| T001 | Define precedence rules for active and recent app context in one conversation. | must-have | no | Unit tests for selection rules |
| T002 | Update host/runtime selectors and context-management to support multiple app instances. | blocked-by:T001 | no | Integration tests |
| T003 | Add attribution and stale-context safeguards for later turns. | blocked-by:T002 | yes | Edge-case tests |
| T004 | Prove the flow with end-to-end multi-app conversation fixtures. | blocked-by:T002,T003 | no | pnpm test and integration smoke |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Multiple-app conversation continuity tests
- T002 tests:
  - [ ] Active/recent precedence coverage
- T003 tests:
  - [ ] Attribution behavior for later follow-up turns

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
