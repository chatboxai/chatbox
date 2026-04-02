# CB-305 Task Breakdown

## Story

- Story ID: CB-305
- Story Title: Bridge host controller adoption for reviewed app launches

## Execution Notes

- Keep the launch seam change narrow and explicit.
- Do not silently mix preview artifact infrastructure with reviewed-app runtime
  infrastructure.
- Prove bridge adoption with tests before touching later multi-app or auth
  stories.

## Story Pack Alignment

- Higher-level pack objectives: O1, O2, O3
- Planned stories in this pack: CB-300, CB-301, CB-302, CB-303, CB-304,
  CB-305
- Why this story set is cohesive: Pack 03 owns the real embedded-app runtime
  seam; this backfill restores that seam as the production launch path.
- Coverage check: this story mainly advances O1, O2, O3.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Audit current reviewed-app launch surfaces and isolate preview-only artifact usage from true app-launch usage. | must-have | no | Code-path map and targeted tests |
| T002 | Route reviewed-app launches through the bridge host controller and normalize runtime state updates through the existing shell. | blocked-by:T001 | no | Runtime and integration tests |
| T003 | Preserve preview artifact behavior and add explicit regression coverage that it remains separate from bridge app launches. | blocked-by:T002 | yes | Artifact regression tests |
| T004 | Add smoke-trace proof for a live reviewed-app bridge launch. | blocked-by:T002,T003 | no | LangSmith trace evidence and smoke docs |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Current launch seam is captured and preview-only behavior is isolated
- T002 tests:
  - [ ] Reviewed app launches through the bridge host controller
- T003 tests:
  - [ ] HTML preview remains intact and separate
- T004 tests:
  - [ ] Smoke harness emits a bridge launch trace for the adopted path

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
