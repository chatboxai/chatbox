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
| T001 | Define the minimal single-app discovery and invocation path for Chess. | must-have | no | contract review | complete via `src/shared/chatbridge/reviewed-app-catalog.ts` and `src/shared/chatbridge/single-app-discovery.ts` |
| T002 | Wire reviewed app/tool selection into the host orchestration path. | blocked-by:T001 | no | integration tests | complete via `src/renderer/packages/chatbridge/single-app-tools.ts` and `src/renderer/packages/model-calls/stream-text.ts` |
| T003 | Emit observable invocation success/failure signals. | blocked-by:T002 | yes | trace and lifecycle checks | complete via `src/shared/chatbridge/tools.ts` normalized rejection/error records and `test/integration/chatbridge/scenarios/single-app-tool-discovery-and-invocation.test.ts` |
| T004 | Add regression coverage for ambiguous, invalid, and failed invocation paths. | blocked-by:T002,T003 | yes | pnpm test and targeted smoke checks | complete via `src/shared/chatbridge/single-app-discovery.test.ts`, `src/renderer/packages/chatbridge/single-app-tools.test.ts`, and `test/integration/chatbridge/scenarios/single-app-tool-discovery-and-invocation.test.ts` |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [x] Single-app selection path is explicit and narrow
- T002 tests:
  - [x] Chess tool invocation works end to end through the host
- T003 tests:
  - [x] Invocation events are traceable for success and failure

## Completion Criteria

- [x] All must-have tasks complete
- [x] Acceptance criteria mapped to completed tasks
- [x] Tests added and passing for each implemented task
- [x] Deferred tasks documented with rationale
  Later Pack 03 stories still own the actual in-thread Chess launch container
  (`CB-301`), live board runtime (`CB-302`), mid-game board-context injection
  (`CB-303`), and completion/resume behavior (`CB-304`). CB-300 intentionally
  stops at reviewed discovery plus host-managed invocation proof.
