# CB-303 Task Breakdown

## Story

- Story ID: CB-303
- Story Title: Mid-game assistant reasoning with live board context

## Execution Notes

- Keep tasks small, verifiable, and mapped to the host-owned contract.
- Do not jump to implementation before the public contract and failure mode are clear.
- Expand visible UI scope only if implementation genuinely requires a surfaced state.
- Preserve existing Chatbox seams and avoid one-off prototypes.

## Story Pack Alignment

- Higher-level pack objectives: O1, O2
- Planned stories in this pack: CB-301, CB-302, CB-303, CB-304
- Why this story set is cohesive: it advances Pack 03 by solving one bounded part of the host/runtime contract.
- Coverage check: this story mainly advances O1, O2.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Define the normalized board summary/state contract for live reasoning turns. | must-have | no | Unit tests around context shape |
| T002 | Integrate active Chess context into message assembly and orchestration. | blocked-by:T001 | no | Integration tests with mocked model path |
| T003 | Add stale/missing-state fallback behavior so follow-up turns degrade gracefully. | blocked-by:T002 | yes | Edge-case tests |
| T004 | Document the boundary between app-owned board detail and model-visible host summary. | blocked-by:T001,T002,T003 | yes | pnpm test |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [x] Context injection for active Chess session
- T002 tests:
  - [x] Fallback behavior when board state is stale
- T003 tests:
  - [x] Model-path tests proving board context enters the prompt assembly path

## Completion Criteria

- [x] All must-have tasks complete
- [x] Acceptance criteria mapped to completed tasks
- [x] Tests added and passing for each implemented task
- [x] Deferred tasks documented with rationale

## Deferred Tasks

- Full in-app Chess runtime visualization remains with the broader Pack 03 UI/runtime stories; CB-303 stays scoped to host-owned reasoning-context injection and regression coverage.
