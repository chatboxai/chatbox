# CB-202 Task Breakdown

## Story

- Story ID: CB-202
- Story Title: App instance and event domain model

## Execution Notes

- Keep tasks small, verifiable, and mapped to the host-owned contract.
- Do not jump to implementation before the public contract and failure mode are clear.
- Expand visible UI scope only if implementation genuinely requires a surfaced state.
- Preserve existing Chatbox seams and avoid one-off prototypes.

## Story Pack Alignment

- Higher-level pack objectives: O2, O3
- Planned stories in this pack: CB-201, CB-202, CB-203, CB-204
- Why this story set is cohesive: it advances Pack 02 by solving one bounded part of the host/runtime contract.
- Coverage check: this story mainly advances O2, O3.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation | Status |
|---|---|---|---|---|---|
| T001 | Define the appInstance and appEvent schema set with clear status transitions. | must-have | no | Domain model tests | complete via `src/shared/chatbridge/instance.ts`, `src/shared/chatbridge/events.ts`, `src/shared/chatbridge/instance.test.ts`, and `src/shared/chatbridge/events.test.ts` |
| T002 | Create storage and selector seams for instance/event reads and writes. | blocked-by:T001 | no | Integration tests for persistence and hydration | complete via `src/renderer/packages/chatbridge/app-records.ts` and `src/renderer/packages/chatbridge/app-records.test.ts` |
| T003 | Document how lifecycle events map to renderer and orchestrator concerns. | blocked-by:T001 | yes | Spec review | complete via checked-in story packet updates plus ChatBridge README and integration-harness notes |
| T004 | Add transition and hydration regression coverage. | blocked-by:T002,T003 | no | pnpm test and pnpm check | complete via `test/integration/chatbridge/scenarios/app-instance-domain-model.test.ts` |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [x] State transition validation
- T002 tests:
  - [x] Illegal lifecycle transition rejection
- T003 tests:
  - [x] App instance serialization and hydration

## Completion Criteria

- [x] All must-have tasks complete
- [x] Acceptance criteria mapped to completed tasks
- [x] Tests added and passing for each implemented task
- [x] Deferred tasks documented with rationale

Deferred tasks:

- None. Later packs still own completion normalization behavior, auth grant persistence, and flagship app wiring.
