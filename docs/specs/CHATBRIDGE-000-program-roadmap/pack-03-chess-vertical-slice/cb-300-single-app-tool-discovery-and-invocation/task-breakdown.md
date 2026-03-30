# CB-300 Task Breakdown

## Story

- Story ID: CB-300
- Story Title: Single-app tool discovery and invocation

## Execution Notes

- Keep this as the narrowest viable end-to-end invocation proof.
- Do not bury discovery/invocation inside later UI stories.
- Instrument the path so Pack 0 trace/eval work is actually used.

## Story Pack Alignment

- Higher-level pack objectives: O1, O2
- Planned stories in this pack: CB-300, CB-301, CB-302, CB-303, CB-304
- Why this story set is cohesive: it proves the single-app path before the full
  UI vertical slice deepens
- Coverage check: this story mainly advances single-app invocation readiness

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Define the minimal single-app discovery and invocation path for Chess. | must-have | no | contract review |
| T002 | Wire reviewed app/tool selection into the host orchestration path. | blocked-by:T001 | no | integration tests |
| T003 | Emit observable invocation success/failure signals. | blocked-by:T002 | yes | trace and lifecycle checks |
| T004 | Add regression coverage for ambiguous, invalid, and failed invocation paths. | blocked-by:T002,T003 | yes | pnpm test and targeted smoke checks |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Single-app selection path is explicit and narrow
- T002 tests:
  - [ ] Chess tool invocation works end to end through the host
- T003 tests:
  - [ ] Invocation events are traceable for success and failure

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
