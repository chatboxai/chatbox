# CB-101 Task Breakdown

## Story

- Story ID: CB-101
- Story Title: Session durability baseline

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
| T001 | Audit current session, thread, export, and compaction paths for assumptions about message part types. | must-have | no | Focused unit/integration tests around hydration and export |
| T002 | Define the compatibility rules for future app-aware message persistence and document any migration or fallback behavior. | blocked-by:T001 | no | Schema and serialization tests |
| T003 | Add regression tests for reload, thread history, and export-sensitive flows. | blocked-by:T001 | yes | vitest run on targeted session/export suites |
| T004 | Wire any required session helper updates while preserving current session data. | blocked-by:T002,T003 | no | pnpm test and pnpm check |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
- [x] Session reload with app-capable messages present
- T002 tests:
  - [x] Thread switching and compaction boundaries with non-text message parts
- T003 tests:
  - [x] Markdown/TXT/HTML export behavior remains valid

## Completion Criteria

- [x] All must-have tasks complete
- [x] Acceptance criteria mapped to completed tasks
- [x] Tests added and passing for each implemented task
- [x] Deferred tasks documented with rationale
