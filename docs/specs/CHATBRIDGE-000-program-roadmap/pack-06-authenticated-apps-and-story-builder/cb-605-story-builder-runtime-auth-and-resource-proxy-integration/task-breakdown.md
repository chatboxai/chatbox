# CB-605 Task Breakdown

## Story

- Story ID: CB-605
- Story Title: Story Builder runtime auth and resource proxy integration

## Execution Notes

- Start from failing live-runtime proof, not from the seeded Story Builder
  shell.
- Keep auth/resource orchestration host-owned and explicit.
- Reopen Pencil only if new visible runtime states exceed the approved Story
  Builder patterns.

## Story Pack Alignment

- Higher-level pack objectives: O2, O4
- Planned stories in this pack: CB-601, CB-602, CB-604, CB-603, CB-605
- Why this story set is cohesive: Pack 06 owns the authenticated-app contract;
  this backfill makes the flagship app actually use that contract in live
  runtime.
- Coverage check: this story mainly advances O2, O4.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Add failing tests and smoke repro that prove Story Builder live runtime is not invoking the auth broker and resource proxy. | must-have | no | Focused failing tests and repro notes |
| T002 | Wire Story Builder runtime actions into the host-owned auth broker and credential-handle lifecycle. | blocked-by:T001 | no | Runtime and integration tests |
| T003 | Route Story Builder resource actions through the host-mediated resource proxy and normalize resulting state. | blocked-by:T002 | no | Integration tests |
| T004 | Add save/resume/auth-expiry/degraded-resource coverage plus smoke-trace proof for the live Story Builder flow. | blocked-by:T002,T003 | yes | pnpm test and LangSmith/manual smoke evidence |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Story Builder live runtime currently bypasses host auth/resource seams
- T002 tests:
  - [ ] Live Story Builder connect flow uses the auth broker
- T003 tests:
  - [ ] Live Story Builder save or load uses the resource proxy
- T004 tests:
  - [ ] Resume, expiry, and degraded-resource recovery stay correct and traced

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
