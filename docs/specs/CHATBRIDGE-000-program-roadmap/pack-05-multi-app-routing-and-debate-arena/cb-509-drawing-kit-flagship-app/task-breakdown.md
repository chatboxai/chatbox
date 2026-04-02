# CB-509 Task Breakdown

## Story

- Story ID: CB-509
- Story Title: Drawing Kit flagship app

## Execution Notes

- Complete Pencil approval before UI code.
- Keep the model-facing state bounded and host-owned.
- Treat Drawing Kit as the new active second flagship app, not as a demo-only
  widget.

## Story Pack Alignment

- Higher-level pack objectives: O1, O2, O3
- Planned stories in this pack: CB-501 through CB-510
- Why this story set is cohesive: Pack 05 owns the active no-auth reviewed-app
  runtime; Drawing Kit is the replacement flagship interactive app.
- Coverage check: this story mainly advances O1, O2, O3.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Produce the Pencil review packet for the inline drawing canvas, controls, and completion/recovery states. | must-have | no | Pencil review packet and approval gate |
| T002 | Define the Drawing Kit shared state, checkpoint, and completion contracts. | blocked-by:T001 | no | Shared contract tests |
| T003 | Implement the Drawing Kit runtime surface and host-owned state updates. | blocked-by:T002 | no | Runtime and integration tests |
| T004 | Add resume, follow-up chat, and degraded-path coverage plus smoke proof. | blocked-by:T002,T003 | yes | pnpm test and manual smoke verification |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Approved visible states are documented before UI code
- T002 tests:
  - [ ] Drawing Kit state and completion contracts fail before implementation
- T003 tests:
  - [ ] Drawing Kit launches and updates host-owned state inline
- T004 tests:
  - [ ] Resume, completion, and degraded states stay correct and traceable

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
