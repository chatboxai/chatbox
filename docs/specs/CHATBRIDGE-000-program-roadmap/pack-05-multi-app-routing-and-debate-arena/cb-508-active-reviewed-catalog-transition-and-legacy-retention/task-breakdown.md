# CB-508 Task Breakdown

## Story

- Story ID: CB-508
- Story Title: Active reviewed catalog transition and legacy retention

## Execution Notes

- Treat this as an active product-direction transition, not as a quiet wording
  tweak.
- Keep legacy retention explicit so future readers know why the old apps still
  exist in the repo.
- Update the queue before implementation work on the new flagship apps starts.

## Story Pack Alignment

- Higher-level pack objectives: O1, O3
- Planned stories in this pack: CB-501 through CB-510
- Why this story set is cohesive: Pack 05 owns the active reviewed-app set and
  the live multi-app runtime; this story resets the flagship inventory before
  the next build lane starts.
- Coverage check: this story mainly advances O1, O3.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Update the roadmap, smoke-audit, and pack status docs to declare the new active flagship set and park legacy apps. | must-have | no | Checked-in docs |
| T002 | Define how the default reviewed catalog, seeds, and presets should represent active versus legacy apps. | blocked-by:T001 | no | Technical plan alignment |
| T003 | Add failing tests or catalog assertions that prove the old active set is no longer the default runtime truth. | blocked-by:T002 | yes | Focused failing tests |
| T004 | Refresh the active queue so Drawing Kit and Weather stories become the next app-build stories. | blocked-by:T001,T002 | no | Progress and pack status updates |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Roadmap and audit docs point to the new active flagship set
- T002 tests:
  - [ ] Catalog and seed contracts distinguish active versus legacy apps
- T003 tests:
  - [ ] Default runtime no longer treats Debate Arena or Story Builder as
    active flagship apps
- T004 tests:
  - [ ] Active rebuild queue points to Drawing Kit and Weather work

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
