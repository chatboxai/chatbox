# CB-006 Task Breakdown

## Story

- Story ID: CB-006
- Story Title: Traceable ChatBridge manual smoke harness and coverage expansion

## Execution Notes

- Keep the scope on observability and smoke workflow, not on fixing the product
  bugs discovered by the audit.
- Prefer one supported traceable smoke path over a broad but unreliable matrix.
- Preserve redaction and vendor-neutral observability constraints.

## Story Pack Alignment

- Higher-level pack objectives: O2, O5
- Planned stories in this pack: CB-000 through CB-006
- Why this story set is cohesive: it restores Pack 00 as the foundation for
  reliable rebuild work once smoke-audit gaps are discovered later.
- Coverage check: this story mainly advances O5 with supporting O2 visibility.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Define the supported traceable smoke workflow and coverage matrix for the rebuilt ChatBridge runtime. | must-have | no | complete: `chatbridge/EVALS_AND_OBSERVABILITY.md` and `test/integration/chatbridge/scenarios/README.md` now publish the supported workflow and matrix |
| T002 | Add or refine the runtime/helper seams needed so supported manual smoke flows emit LangSmith traces reliably. | blocked-by:T001 | no | complete: `src/renderer/dev/chatbridgeManualSmoke.ts` and `src/renderer/components/dev/ChatBridgeSeedLab.tsx` emit named manual-smoke traces with explicit support gating |
| T003 | Expand scenario trace coverage and naming so major rebuild families leave distinct evidence. | blocked-by:T001,T002 | yes | complete: `test/integration/chatbridge/scenarios/scenario-tracing.ts` and representative scenario files emit named eval traces |
| T004 | Update the smoke ledger and observability docs with the new trace collection procedure. | blocked-by:T001,T002,T003 | yes | complete: story status, Pack 00 control docs, and `smoke-audit-master.md` record the trace procedure and proof set |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [x] Coverage matrix documented against current scenario families
- T002 tests:
  - [x] Supported smoke path emits parent traces
- T003 tests:
  - [x] Scenario trace families are emitted and inspectable

## Completion Criteria

- [x] All must-have tasks complete
- [x] Acceptance criteria mapped to completed tasks
- [x] Tests added and passing for each implemented task
- [x] Deferred tasks documented with rationale
