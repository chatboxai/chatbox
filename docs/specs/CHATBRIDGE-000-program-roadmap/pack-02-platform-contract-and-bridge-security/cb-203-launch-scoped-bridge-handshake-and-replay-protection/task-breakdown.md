# CB-203 Task Breakdown

## Story

- Story ID: CB-203
- Story Title: Launch-scoped bridge handshake and replay protection

## Execution Notes

- Keep tasks small, verifiable, and mapped to the host-owned contract.
- Do not jump to implementation before the public contract and failure mode are clear.
- Expand visible UI scope only if implementation genuinely requires a surfaced state.
- Preserve existing Chatbox seams and avoid one-off prototypes.

## Story Pack Alignment

- Higher-level pack objectives: O2, O3
- Planned stories in this pack: CB-201, CB-202, CB-203, CB-204
- Why this story set is cohesive: it advances Pack 02 by solving one bounded part of the host/runtime contract.
- Coverage check: this story mainly advances O2, O3.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Define the bridgeSession bootstrap contract and handshake sequence. | must-have | no | Contract tests |
| T002 | Implement the bound channel/session validation path in the host and preload/runtime bridge. | blocked-by:T001 | no | Integration tests with mock app runtime |
| T003 | Add sequence and idempotency enforcement for state-changing events. | blocked-by:T002 | yes | Replay/duplicate tests |
| T004 | Document security expectations and failure modes for reviewed partners. | blocked-by:T001,T002,T003 | yes | pnpm test and design review of bridge rules |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [x] Handshake success and failure paths
- T002 tests:
  - [x] Unexpected origin/session rejection
- T003 tests:
  - [x] Replay/duplicate event rejection behavior

## Completion Criteria

- [x] All must-have tasks complete
- [x] Acceptance criteria mapped to completed tasks
- [x] Tests added and passing for each implemented task
- [x] Deferred tasks documented with rationale

## Completion Notes

- T001 completed by defining the shared bridge-session envelope, ready/state/error/complete event contracts, and host-side validation in `src/shared/chatbridge/bridge-session.ts`.
- T002 completed by adding the dedicated host/runtime bridge controller in `src/renderer/packages/chatbridge/bridge/host-controller.ts` and wiring the artifact preview to use a transferred `MessagePort` instead of ambient `postMessage('*')`.
- T003 completed by enforcing monotonic sequence and idempotency checks in the shared validation layer, then covering replay rejection through `test/integration/chatbridge/scenarios/bridge-session-security.test.ts`.
- T004 completed by recording the security seam and validation evidence in this story packet and by keeping the approved CB-103 shell while replacing the runtime bridge under `src/renderer/components/Artifact.tsx`.
