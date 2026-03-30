# CB-001 Task Breakdown

## Story

- Story ID: CB-001
- Story Title: Service topology and deployment foundation

## Execution Notes

- Keep topology decisions aligned with the checked-in architecture.
- Separate local development assumptions from future backend authority clearly.
- Avoid inventing hosted services without a grounded reason.

## Story Pack Alignment

- Higher-level pack objectives: Pack 0 foundation
- Planned stories in this pack: CB-000, CB-001, CB-002, CB-003
- Why this story set is cohesive: it establishes infrastructure and runtime
  assumptions before product-facing packs
- Coverage check: this story mainly advances deployment and ownership clarity

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Map current Electron, preload, renderer, and request boundaries against the ChatBridge architecture. | must-have | no | architecture consistency review |
| T002 | Define local-dev versus backend-authoritative ownership assumptions for later packs. | blocked-by:T001 | no | technical-plan review |
| T003 | Publish the durable topology reference in `chatbridge/SERVICE_TOPOLOGY.md`. | blocked-by:T002 | yes | doc review |
| T004 | Record deployment and service dependencies for auth, registry, persistence, and policy work. | blocked-by:T002,T003 | yes | roadmap consistency check |
| T005 | Surface unresolved topology risks so later stories do not silently guess. | blocked-by:T002,T003,T004 | yes | packet completeness review |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Current repo boundaries are mapped to the ChatBridge architecture
- T002 tests:
  - [ ] Ownership assumptions are explicit for local and hosted concerns
- T003 tests:
  - [ ] The topology reference exists and matches the story packet
- T004 tests:
  - [ ] Later packs can reference real service boundaries instead of guessing

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Deferred tasks documented with rationale
- [ ] `chatbridge/SERVICE_TOPOLOGY.md` exists and is linked from `chatbridge/README.md`
