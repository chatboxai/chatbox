# CB-506 Task Breakdown

## Story

- Story ID: CB-506
- Story Title: Live reviewed app invocation path beyond Chess

## Execution Notes

- Start from failing fresh-runtime tests and smoke repro, not from a broad
  rewrite.
- Keep invoke-path repairs separate from clarify/refuse UI work.
- Do not silently reintroduce app-specific shortcuts once the reviewed invoke
  seam exists.

## Story Pack Alignment

- Higher-level pack objectives: O1, O2, O3
- Planned stories in this pack: CB-501, CB-502, CB-503, CB-504, CB-505,
  CB-506, CB-507
- Why this story set is cohesive: Pack 05 owns the live reviewed multi-app
  runtime; this backfill makes the runtime actually launch more than Chess.
- Coverage check: this story mainly advances O1, O2, O3.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Add failing tests that prove the live generation path is still Chess-only, misses natural Chess prompts, and should launch a reviewed non-Chess app. | must-have | no | Focused failing tests |
| T002 | Replace the Chess-only execution shortcut with a reviewed invoke path that consumes route decisions, preserves robust Chess intent handling, and uses host-owned launch control. | blocked-by:T001 | no | Runtime and integration tests |
| T003 | Add explicit launch-failure and trace coverage for the new invoke path. | blocked-by:T002 | yes | Failure-path tests and trace evidence |
| T004 | Re-run fresh-thread manual smoke prompts for natural Chess requests and non-Chess launch behavior. | blocked-by:T002,T003 | no | Manual smoke notes |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Fresh runtime non-Chess app launch currently fails for the wrong reason
  - [ ] Natural Chess prompts still fall through to chat-only or ambiguous outcomes
- T002 tests:
  - [ ] Live prompt path invokes a non-Chess reviewed app
  - [ ] Live prompt path still routes natural Chess prompts into Chess
- T003 tests:
  - [ ] Launch failures are explicit and traced
- T004 tests:
  - [ ] Manual smoke confirms the live invoke path no longer behaves like
    Chess-only runtime

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
