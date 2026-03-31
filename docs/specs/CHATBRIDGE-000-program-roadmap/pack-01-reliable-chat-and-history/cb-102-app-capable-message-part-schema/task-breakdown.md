# CB-102 Task Breakdown

## Story

- Story ID: CB-102
- Story Title: App-capable message part schema

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
| T001 | Define app-aware message part types and migration-safe schema updates. | must-have | no | Schema parsing tests |
| T002 | Update shared message helpers and timeline branching logic for the new parts. | blocked-by:T001 | no | Targeted renderer/unit tests |
| T003 | Document the intended usage boundary between tool-call parts and app-aware parts. | blocked-by:T001 | yes | Spec review plus schema comments/tests |
| T004 | Add backward-compatibility and serialization regression coverage. | blocked-by:T002,T003 | no | pnpm test and pnpm check |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [x] Schema parse/serialize for new app-aware message parts
- T002 tests:
  - [x] Unknown/legacy message compatibility behavior
- T003 tests:
  - [x] Renderer handling of app-aware parts without throwing

## Completion Criteria

- [x] All must-have tasks complete
- [x] Acceptance criteria mapped to completed tasks
- [x] Tests added and passing for each implemented task
- [x] Deferred tasks documented with rationale
