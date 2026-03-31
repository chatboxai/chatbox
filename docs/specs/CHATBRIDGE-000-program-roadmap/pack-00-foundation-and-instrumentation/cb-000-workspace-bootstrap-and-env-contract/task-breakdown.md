# CB-000 Task Breakdown

## Story

- Story ID: CB-000
- Story Title: Workspace bootstrap and env contract

## Execution Notes

- Keep the contract simple and repo-grounded.
- Capture missing assumptions explicitly instead of burying them in future work.
- Avoid introducing new tooling until the existing repo paths are understood.
- Use checked-in docs as the delivery surface for this story.

## Story Pack Alignment

- Higher-level pack objectives: Pack 0 foundation
- Planned stories in this pack: CB-000, CB-001, CB-002, CB-003
- Why this story set is cohesive: it establishes the bootstrap baseline all
  later ChatBridge stories depend on
- Coverage check: this story mainly advances foundation readiness

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Inventory current bootstrap, auth, and request setup paths relevant to ChatBridge. | must-have | no | repo inspection and documented findings |
| T002 | Define the required env/secrets and safe-missing-env contract. | blocked-by:T001 | no | spec review |
| T003 | Document local/shared bootstrap assumptions and open gaps in `chatbridge/BOOTSTRAP.md`. | blocked-by:T002 | yes | packet completeness review |
| T004 | Align root developer setup docs with the real package-manager/bootstrap contract. | blocked-by:T002,T003 | yes | README consistency review |
| T005 | Map this contract to the next packs as an explicit dependency. | blocked-by:T002,T003,T004 | yes | roadmap consistency check |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [x] Bootstrap and env assumptions are grounded in current repo seams
- T002 tests:
  - [x] Missing-env and malformed-env behaviors are documented
- T003 tests:
  - [x] Local/shared setup guidance is specific enough for future story work
- T004 tests:
  - [x] Checked-in entry docs do not contradict the actual repo bootstrap path

## Completion Criteria

- [x] All must-have tasks complete
- [x] Acceptance criteria mapped to completed tasks
- [x] Deferred tasks documented with rationale
- [x] `chatbridge/BOOTSTRAP.md` exists and is linked from entry docs

## Completion Notes

- AC-1 through AC-3 are satisfied by `chatbridge/BOOTSTRAP.md`, which documents
  the local/shared bootstrap contract, env inventory, and safe-missing-env
  behavior.
- AC-4 is satisfied by `README.md`, which now points developers at the current
  `pnpm` bootstrap path and links the durable ChatBridge bootstrap contract.
- AC-5 is satisfied by the explicit gap sections in `chatbridge/BOOTSTRAP.md`
  and `technical-plan.md`.
- Deferred work is limited to future-pack backend/service env ownership, which
  remains called out explicitly in `technical-plan.md` and is intentionally out
  of scope for this story.
