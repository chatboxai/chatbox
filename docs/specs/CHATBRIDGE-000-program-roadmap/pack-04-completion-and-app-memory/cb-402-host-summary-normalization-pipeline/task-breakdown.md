# CB-402 Task Breakdown

## Story

- Story ID: CB-402
- Story Title: Host summary normalization pipeline

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
| T001 | Define the normalization pipeline inputs, outputs, and rejection paths. | must-have | no | Unit tests around summary normalization |
| T002 | Implement redaction and host-approved summary generation. | blocked-by:T001 | no | Normalization tests |
| T003 | Wire normalized summaries into the current context-management/orchestration path. | blocked-by:T002 | no | Integration tests with model context assembly |
| T004 | Add regression coverage proving apps cannot bypass the normalization step. | blocked-by:T002,T003 | yes | pnpm test |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Normalization success and rejection behavior
- T002 tests:
  - [ ] Redaction coverage for sensitive or irrelevant fields
- T003 tests:
  - [ ] Later-turn retrieval of normalized summary data

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
