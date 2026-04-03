# I001-01 Task Breakdown

## Story

- Story ID: I001-01
- Story Title: Renderer execution governor entrypoint and reviewed-route adoption

## Execution Notes

- Start from failing focused tests that prove the new governor seam does not
  exist yet.
- Keep the first `I001` slice bounded to renderer runtime orchestration.
- Do not mix backend-authoritative state, operator surfaces, or bridge-session
  rewrites into this story.

## Initiative Alignment

- Higher-level initiative: `CHATBRIDGE-001`
- Active phase: `I001` Unified execution governor
- Why this story is first:
  it creates the first concrete runtime governor seam without prematurely
  absorbing later-phase responsibilities.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Add failing tests for the missing governor seam, including invoke, clarify/refuse, and non-fatal trace failure behavior. | must-have | no | Focused failing tests |
| T002 | Add the shared governor contract and the renderer execution-governor entrypoint. | blocked-by:T001 | no | Unit tests |
| T003 | Adopt the new governor seam in `streamText` and preserve reviewed launch normalization. | blocked-by:T002 | no | Runtime tests |
| T004 | Add story-owned scenario proof for live invoke plus clarify/refuse behavior through the governor seam. | blocked-by:T003 | yes | Scenario traces and integration tests |
| T005 | Update initiative status/docs and rerun full repo validation. | blocked-by:T003,T004 | no | Repo gates |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] There is no explicit renderer execution-governor entrypoint yet
  - [ ] Route decision trace payload generation is still bound to `streamText`
- T002 tests:
  - [ ] Governor returns wrapped tools and stable route resolution metadata
  - [ ] Governor keeps tool-use-disabled paths bounded
- T003 tests:
  - [ ] `streamText` still produces reviewed invoke parts through the governor
  - [ ] `streamText` still produces clarify/refuse artifacts through the governor
- T004 tests:
  - [ ] Story-owned scenario traces prove invoke, natural Chess, clarify, and refuse paths
- T005 tests:
  - [ ] Initiative docs point to the active `I001-01` story and the repo gates are green

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred responsibilities documented explicitly
