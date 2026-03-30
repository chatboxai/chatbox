# CB-104 Task Breakdown

## Story

- Story ID: CB-104
- Story Title: App-aware persistence regression coverage

## Execution Notes

- Keep tasks small, verifiable, and mapped to the host-owned contract.
- Do not jump to implementation before the public contract and failure mode are clear.
- Expand visible UI scope only if implementation genuinely requires a surfaced state.
- Preserve existing Chatbox seams and avoid one-off prototypes.

## Story Pack Alignment

- Higher-level pack objectives: O1, O2
- Planned stories in this pack: CB-101, CB-102, CB-103, CB-104
- Why this story set is cohesive: it advances Pack 01 by solving one bounded part of the host/runtime contract.
- Coverage check: this story mainly advances O1, O2.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Design the ChatBridge-focused regression fixture set for session and export flows. | must-have | no | Fixture review plus targeted tests |
| T002 | Add integration tests for reload, thread history, and app-aware formatting paths. | blocked-by:T001 | no | vitest integration suites |
| T003 | Cover stale or partial lifecycle cases so later packs inherit a clear failure baseline. | blocked-by:T001 | yes | Targeted edge-case tests |
| T004 | Document the regression suite as the baseline gate for later ChatBridge packs. | blocked-by:T002,T003 | yes | pnpm test |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Integration fixture for app-aware session reload
- T002 tests:
  - [ ] Export snapshot or assertion coverage
- T003 tests:
  - [ ] Stale/partial lifecycle hydration behavior

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
