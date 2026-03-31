# CB-201 Task Breakdown

## Story

- Story ID: CB-201
- Story Title: Reviewed app manifest and registry contract

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
| T001 | Define the reviewed app manifest schema and approval-facing metadata contract. | must-have | no | Schema validation tests | complete via `src/shared/chatbridge/manifest.ts` and `src/shared/chatbridge/manifest.test.ts` |
| T002 | Add registry-side normalization and compatibility checks. | blocked-by:T001 | no | Integration tests with valid/invalid manifests | complete via `src/shared/chatbridge/registry.ts` and `src/shared/chatbridge/registry.test.ts` |
| T003 | Document the contract and host expectations for reviewed partners. | blocked-by:T001 | yes | Spec review | complete via checked-in story packet updates and ChatBridge harness/README notes |
| T004 | Add host-side tests for consuming the approved app catalog safely. | blocked-by:T002,T003 | no | pnpm test and pnpm check | complete via `test/integration/chatbridge/fixtures/reviewed-app-manifests.ts` and `test/integration/chatbridge/scenarios/reviewed-app-registry.test.ts` |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [x] Manifest parse/validation coverage
- T002 tests:
  - [x] Unsupported version rejection
- T003 tests:
  - [x] Invalid permission/auth metadata rejection

## Completion Criteria

- [x] All must-have tasks complete
- [x] Acceptance criteria mapped to completed tasks
- [x] Tests added and passing for each implemented task
- [x] Deferred tasks documented with rationale

Deferred tasks:

- None. Later Pack 02 stories still own app instances, bridge handshakes, and tool execution semantics.
