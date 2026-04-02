# CB-105 Task Breakdown

## Story

- Story ID: CB-105
- Story Title: ChatBridge session console and accessibility hygiene

## Execution Notes

- Keep this correction narrow; do not turn it into a general UI refactor.
- Reproduce each warning from the smoke console before changing code.
- Preserve current seeded-session behavior while reducing noise.

## Story Pack Alignment

- Higher-level pack objectives: O1
- Planned stories in this pack: CB-101 through CB-105
- Why this story set is cohesive: it preserves the chat/session baseline that
  later ChatBridge runtime work depends on.
- Coverage check: this story mainly advances O1.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Reproduce the confirmed React prop and accessibility warnings from the smoke audit logs. | must-have | no | repro notes and targeted tests |
| T002 | Fix the invalid DOM prop forwarding path. | blocked-by:T001 | no | component tests and smoke log |
| T003 | Fix the focused `aria-hidden` shell transition path. | blocked-by:T001 | no | interaction test and smoke log |
| T004 | Add regression coverage and rerun the seeded ChatBridge smoke console check. | blocked-by:T002,T003 | yes | targeted tests and manual smoke |

## TDD Mapping

- T001 tests:
  - [ ] Existing warning-producing render path captured
- T002 tests:
  - [ ] Invalid DOM prop no longer forwarded
- T003 tests:
  - [ ] Focus transition avoids hidden focused subtree

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
