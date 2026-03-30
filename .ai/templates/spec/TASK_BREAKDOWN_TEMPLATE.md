# Task Breakdown Template

## Story
- Story ID:
- Story Title:

## Execution Notes
- Keep tasks small and verifiable.
- Mark dependencies explicitly.
- Mark parallelizable tasks explicitly.

## Story Pack Alignment (for phase packs or multi-story planning)
- Higher-level pack objectives:
- Planned stories in this pack:
- Why this story set is cohesive:
- Coverage check: which objective each story advances:

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 |  | must-have | no | |
| T002 |  | blocked-by:T001 | yes | |
| T003 |  | blocked-by:T001 | yes | |
| T004 |  | blocked-by:T002,T003 | no | |

Dependency values:
- `must-have` (no prerequisite)
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

For each task, list associated tests first:

- T001 tests:
  - [ ] test_...
- T002 tests:
  - [ ] test_...

## Completion Criteria
- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
