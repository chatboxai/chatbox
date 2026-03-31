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
  - [x] Current integration seams are mapped to future ChatBridge use
- T002 tests:
  - [x] Mock and harness contracts are specific enough for later story work
- T003 tests:
  - [x] The starter ChatBridge harness location exists and matches the contract
- T004 tests:
  - [x] Later packs can identify where real integrations are required

## Completion Criteria

- [x] All must-have tasks complete
- [x] Acceptance criteria mapped to completed tasks
- [x] Deferred tasks documented with rationale
- [x] `chatbridge/INTEGRATION_HARNESS.md` exists and `test/integration/chatbridge/` is present

## Recorded Evidence

- Durable harness reference:
  `chatbridge/INTEGRATION_HARNESS.md`
- Starter ChatBridge harness location:
  `test/integration/chatbridge/README.md`
- Starter fixture and mock placeholders:
  `test/integration/chatbridge/fixtures/README.md`,
  `test/integration/chatbridge/mocks/README.md`, and
  `test/integration/chatbridge/scenarios/README.md`
- Existing integration seam examples:
  `test/integration/file-conversation/test-harness.ts`,
  `test/integration/file-conversation/setup.ts`,
  `test/integration/model-provider/model-provider.test.ts`,
  `test/integration/mocks/model-dependencies.ts`, and
  `test/integration/mocks/sentry.ts`

## Deferred Follow-up

- Add concrete manifest, lifecycle, completion, and failure payload fixtures to
  the existing `test/integration/chatbridge/fixtures/` space as Pack 02+
  contracts harden.
- Add real mock registry, policy, auth-broker, and partner-runtime helpers to
  `test/integration/chatbridge/mocks/` instead of creating a second harness
  location later.
