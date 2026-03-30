# CB-002 Task Breakdown

## Story

- Story ID: CB-002
- Story Title: Integration harness and provider fixtures

## Execution Notes

- Reuse current provider and test seams where possible.
- Favor realistic contract mocks over overly abstract fake systems.
- Make later flagship app and bridge testing easier, not heavier.

## Story Pack Alignment

- Higher-level pack objectives: Pack 0 foundation
- Planned stories in this pack: CB-000, CB-001, CB-002, CB-003
- Why this story set is cohesive: it establishes reusable integration and
  testing readiness before platform features land
- Coverage check: this story mainly advances integration readiness

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Audit current provider, request, and test seams that can support ChatBridge fixtures. | must-have | no | repo-grounded findings |
| T002 | Define reusable mock provider and mock app harness expectations. | blocked-by:T001 | no | technical-plan review |
| T003 | Publish the durable harness reference in `chatbridge/INTEGRATION_HARNESS.md` and add the starter folder layout. | blocked-by:T002 | yes | doc and folder review |
| T004 | Map later packs to likely mock-versus-real integration paths. | blocked-by:T002,T003 | yes | roadmap consistency check |
| T005 | Record failure-path fixture expectations for runtime, provider, and host boundaries. | blocked-by:T002,T003 | yes | packet completeness review |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Current integration seams are mapped to future ChatBridge use
- T002 tests:
  - [ ] Mock and harness contracts are specific enough for later story work
- T003 tests:
  - [ ] The starter ChatBridge harness location exists and matches the contract
- T004 tests:
  - [ ] Later packs can identify where real integrations are required

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Deferred tasks documented with rationale
- [ ] `chatbridge/INTEGRATION_HARNESS.md` exists and `test/integration/chatbridge/` is present
