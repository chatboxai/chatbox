# CB-505 Task Breakdown

## Story

- Story ID: CB-505
- Story Title: Default reviewed app catalog parity for flagship apps

## Execution Notes

- Treat this as runtime truth restoration, not as a speculative expansion.
- Keep catalog membership explicit and reviewed.
- Do not silently conflate catalog presence with full launch/auth readiness.

## Story Pack Alignment

- Higher-level pack objectives: O1, O3
- Planned stories in this pack: CB-501, CB-502, CB-503, CB-504, CB-505,
  CB-506, CB-507
- Why this story set is cohesive: Pack 05 owns the live multi-app runtime
  inventory and route behavior; this backfill fixes the starting catalog truth.
- Coverage check: this story mainly advances O1, O3.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Audit the default reviewed catalog against the scoped flagship inventory and record the required runtime entries. | must-have | no | Spec and regression list |
| T002 | Add the approved flagship catalog entries and any required manifest metadata to the shared reviewed catalog. | blocked-by:T001 | no | Unit tests |
| T003 | Update router and launch selection tests so fresh runtime behavior sees the full flagship set. | blocked-by:T002 | yes | Integration tests |
| T004 | Re-run the fresh-prompt smoke checks that previously failed because only Chess existed in the default catalog. | blocked-by:T002,T003 | no | Manual smoke notes or trace evidence |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Default catalog inventory gap is captured in a failing assertion
- T002 tests:
  - [ ] Default catalog exposes the approved flagship entries
- T003 tests:
  - [ ] Fresh runtime routing sees the new entries
- T004 tests:
  - [ ] Story Builder and Debate Arena no longer fail purely because the app is
    absent from the default catalog

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
