# CB-301 Task Breakdown

## Story

- Story ID: CB-301
- Story Title: In-thread app launch and rendering flow

## Execution Notes

- Keep tasks small, verifiable, and mapped to the host-owned contract.
- Do not jump to implementation before the public contract and failure mode are clear.
- Complete the Pencil review and approval gate before any UI coding work.
- Preserve existing Chatbox seams and avoid one-off prototypes.

## Story Pack Alignment

- Higher-level pack objectives: O1, O2
- Planned stories in this pack: CB-301, CB-302, CB-303, CB-304
- Why this story set is cohesive: it advances Pack 03 by solving one bounded part of the host/runtime contract.
- Coverage check: this story mainly advances O1, O2.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Create the per-story Pencil review for the in-thread Chess launch surface and active-state container. | must-have | no | Pencil review packet and approval gate |
| T002 | Wire the host launch path from routed chat intent to app instance and timeline artifact. | blocked-by:T001 | no | Integration tests with mock Chess registration |
| T003 | Implement the approved in-thread render state for loading, ready, and launch failure. | blocked-by:T001,T002 | no | Renderer smoke tests |
| T004 | Add accessibility and session-state regression coverage. | blocked-by:T002,T003 | yes | pnpm test and pnpm check |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Launch flow integration test from user message to app container render
- T002 tests:
  - [ ] Active session pointer behavior
- T003 tests:
  - [ ] Fallback rendering if launch fails or app is unavailable

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
