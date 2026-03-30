# CB-502 Task Breakdown

## Story

- Story ID: CB-502
- Story Title: Route, clarify, or refuse decision path

## Execution Notes

- Keep tasks small, verifiable, and mapped to the host-owned contract.
- Do not jump to implementation before the public contract and failure mode are clear.
- Complete the Pencil review and approval gate before any UI coding work.
- Preserve existing Chatbox seams and avoid one-off prototypes.

## Story Pack Alignment

- Higher-level pack objectives: O1, O3
- Planned stories in this pack: CB-501, CB-502, CB-503, CB-504
- Why this story set is cohesive: it advances Pack 05 by solving one bounded part of the host/runtime contract.
- Coverage check: this story mainly advances O1, O3.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Create the Pencil review packet for clarify/refuse timeline states. | must-have | no | Pencil review packet and approval gate |
| T002 | Define and implement invoke/clarify/refuse decision semantics in the router. | blocked-by:T001 | no | Routing logic tests |
| T003 | Render the approved clarifier and refusal artifacts in the timeline. | blocked-by:T001,T002 | no | Renderer and accessibility tests |
| T004 | Add follow-up and edge-case routing regression coverage. | blocked-by:T002,T003 | yes | pnpm test and routing smoke tests |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Confident route behavior
- T002 tests:
  - [ ] Clarifier rendering and follow-up behavior
- T003 tests:
  - [ ] Refusal behavior for unrelated prompts

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
