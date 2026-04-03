# I001-02 Task Breakdown

## Story

- Story ID: I001-02
- Story Title: ChatBridge tray renderable-surface gating

## Execution Notes

- Start from failing focused tests that demonstrate the current phantom tray and
  anchor behavior for inline-only route artifacts.
- Keep the story renderer-local unless the implementation uncovers a deeper
  contract gap that cannot be solved in presentation code.
- Treat seed and lab updates as part of done if the visible default experience
  changes.

## Initiative Alignment

- Higher-level initiative:
  `CHATBRIDGE-001`
- Why this story belongs here:
  it tightens post-rebuild runtime truth so the visible ChatBridge shell stops
  claiming a docked app exists when the renderer has nothing to show.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Add failing focused tests for non-renderable route artifacts incorrectly qualifying for tray or anchor behavior. | must-have | no | Focused Vitest runs |
| T002 | Introduce the shared ChatBridge surface classification helper and mark tray-eligible versus inline-only app parts explicitly. | blocked-by:T001 | no | Unit tests |
| T003 | Adopt the shared helper in `floating-runtime.ts`, message anchor selection, and any supporting presentation glue. | blocked-by:T002 | no | Unit and component tests |
| T004 | Trim or guard tray-specific copy and affordances so only tray-eligible runtimes expose them. | blocked-by:T003 | no | Component tests |
| T005 | Refresh ChatBridge seed and lab fixtures when needed, then rerun the repo validation baseline. | blocked-by:T003,T004 | no | Seed audit plus repo gates |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] A refusal or clarify route artifact does not become the floating tray
        target
  - [ ] A non-tray app part does not switch the message shell into anchor mode
- T002 tests:
  - [ ] Reviewed launch and known real runtime surfaces are classified as
        tray-eligible
  - [ ] Inline route artifacts are classified as inline-only
- T003 tests:
  - [ ] The session tray mounts only for tray-eligible parts
  - [ ] Mixed histories keep the latest real runtime floated even when a later
        inline receipt appears
- T004 tests:
  - [ ] Route artifacts never show tray-only copy or "Focus/Restore app"
        affordances
- T005 tests:
  - [ ] Seeded or lab examples still demonstrate the intended tray and inline
        behaviors
  - [ ] Full repo validation passes

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Seed and lab obligations satisfied or explicitly waived in handoff
