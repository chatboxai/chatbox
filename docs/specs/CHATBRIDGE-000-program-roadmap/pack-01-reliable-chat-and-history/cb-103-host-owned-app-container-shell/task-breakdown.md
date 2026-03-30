# CB-103 Task Breakdown

## Story

- Story ID: CB-103
- Story Title: Host-owned app container shell

## Execution Notes

- Keep tasks small, verifiable, and mapped to the host-owned contract.
- Do not jump to implementation before the public contract and failure mode are clear.
- Complete the Pencil review and approval gate before any UI coding work.
- Preserve existing Chatbox seams and avoid one-off prototypes.

## Story Pack Alignment

- Higher-level pack objectives: O1, O2
- Planned stories in this pack: CB-101, CB-102, CB-103, CB-104
- Why this story set is cohesive: it advances Pack 01 by solving one bounded part of the host/runtime contract.
- Coverage check: this story mainly advances O1, O2.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Create the per-story Pencil review packet and approved variation for the embedded app container states. | must-have | no | Pencil review packet and approval gate |
| T002 | Define the container behavior/state model and wire the host-owned renderer seam. | blocked-by:T001 | no | Component/unit tests |
| T003 | Implement the container UI using approved design-system patterns and timeline integration. | blocked-by:T001,T002 | no | Renderer smoke test |
| T004 | Add accessibility and fallback-state regression tests. | blocked-by:T002,T003 | yes | pnpm test and pnpm check |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Renderer state coverage for loading/ready/error/complete
- T002 tests:
  - [ ] Accessibility coverage for focus, labels, and keyboard affordances
- T003 tests:
  - [ ] Smoke test that app-aware timeline parts render without crashing the thread

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
