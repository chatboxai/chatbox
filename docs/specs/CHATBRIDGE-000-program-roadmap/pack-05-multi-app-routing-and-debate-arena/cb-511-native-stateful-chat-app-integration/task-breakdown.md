# CB-511 Task Breakdown

## Story

- Story ID: CB-511
- Story Title: Native stateful chat-app integration

## Execution Notes

- Do not collapse this into one implementation blob.
- Keep read-state widening separate from write-state command paths.
- Land Chess first as the host-owned proof before broadening reviewed-runtime
  command writes.
- Treat screenshots as explicit app-linked artifacts, not ambient model access.

## Story Pack Alignment

- Higher-level pack objectives: O1, O2, O3
- Planned stories in this pack: CB-501 through CB-511
- Why this story set is cohesive: Pack 05 owns the active no-auth flagship
  reviewed apps and the quality of chat/app continuity around them.
- Coverage check: this story mainly advances O1 and O2, with O3 guardrails on
  state exposure and auditability.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Define the tiered app-context contract: summary, bounded structured digest, and optional screenshot refs. | must-have | no | Contract tests for digest selection and clamping |
| T002 | Implement read-only active-app deep-state injection and history reads for selected flagship apps. | blocked-by:T001 | yes | Context-management and integration tests |
| T003 | Add host-native Chess commands for move, undo, explain, and history against the active app instance. | blocked-by:T001 | yes | Chess contract and integration tests |
| T004 | Add app-linked screenshot capture, persistence, and reasoning/context plumbing. | blocked-by:T001 | yes | Screenshot contract and integration tests |
| T005 | Extend the reviewed runtime bridge for bounded host-originated commands and wire Drawing Kit draw/erase/tool/checkpoint actions. | blocked-by:T001 | no | Reviewed runtime and scenario tests |
| T006 | Add scenario proof, seed coverage, and manual-smoke guidance for the native stateful flows. | blocked-by:T002,T003,T004,T005 | no | `pnpm test` plus smoke notes and seeded example review |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Digest builders fail before implementation and reject oversized or raw
    state
- T002 tests:
  - [ ] Selected active-app context can include bounded structured state without
    leaking non-selected app memory
- T003 tests:
  - [ ] Chat-issued Chess commands mutate only the trusted active instance and
    reject illegal moves
- T004 tests:
  - [ ] Screenshot capture produces bounded app-linked artifacts and explicit
    degraded behavior
- T005 tests:
  - [ ] Drawing Kit host commands round-trip through the reviewed runtime and
    persist normalized host state
- T006 tests:
  - [ ] Representative end-to-end scenarios cover read-state, write-state,
    screenshot reasoning, and degraded fallback

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
