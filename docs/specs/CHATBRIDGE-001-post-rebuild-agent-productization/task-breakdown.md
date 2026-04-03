# ChatBridge Post-Rebuild Agent Productization Task Breakdown

## Story

- Story ID: CHATBRIDGE-001
- Story Title: Post-rebuild agent productization and Ghostfolio-parity initiative

## Execution Notes

- This initiative is blocked until the active rebuild queue in
  `docs/specs/CHATBRIDGE-000-program-roadmap/progress.md` is complete.
- This packet is not an implementation shortcut around the queue.
- Keep the priority order requested by the user:
  control plane first, policy/refusal and verification late, high-risk action
  workflow last.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| I001 | Unified execution governor | blocked-by:CHATBRIDGE-000 queue complete | no | runtime integration tests, live smoke proof |
| I002 | Backend-authoritative app state and reconciliation | blocked-by:I001 | partial | app record and reconciliation tests |
| I003 | Operator/admin/feedback productization | blocked-by:I001 | partial | operator state and observability surface tests |
| I004 | Architecture and runtime truth sync | blocked-by:I001 | yes | doc audit and smoke-doc alignment review |
| I005 | Policy and refusal layer | blocked-by:I001,I002 | no | refusal and tool-audit behavior tests |
| I006 | Verification, confidence, and provenance layer | blocked-by:I001,I002 | no | verification aggregation tests and grounded response snapshots |
| I007 | High-risk action workflow | blocked-by:I005,I006 | no | preview/confirm/execute and audit tests |

## Ordered Initiative Queue

1. I001 Unified execution governor
2. I002 Backend-authoritative app state and reconciliation
3. I003 Operator/admin/feedback productization
4. I004 Architecture and runtime truth sync
5. I005 Policy and refusal layer
6. I006 Verification, confidence, and provenance layer
7. I007 High-risk action workflow

## Active Story Queue

- I001 validated so far:
  - `I001-01` Renderer execution governor entrypoint and reviewed-route adoption

## TDD Mapping

- I001 tests:
  one runtime entrypoint owns route, launch, bridge lifecycle, completion
  handoff, and recovery handoff
- I002 tests:
  durable app instance records, event replay rules, resume/reconnect
  reconciliation, stale-write prevention
- I003 tests:
  app health rollups, recovery histories, trace-link and feedback surfaces
- I004 tests:
  docs and seeded/manual smoke truth reflect the active flagship set and actual
  runtime path
- I005 tests:
  pre-orchestration refusal, post-tool audit, fail-closed refusal contracts
- I006 tests:
  confidence policy, source attribution, verification aggregation for external
  data-backed flows
- I007 tests:
  preview-only writes, explicit confirmation state, audited execution outcomes,
  cancellation and rollback behavior

## Completion Criteria

- [ ] The active rebuild queue is fully closed before this initiative begins.
- [ ] The first phase produces one clear execution governor runtime seam.
- [ ] The second phase establishes durable state authority and reconciliation.
- [ ] Operator/admin/feedback work exists before policy and verification phases.
- [ ] Policy/refusal, verification/confidence, and high-risk actions remain
      late phases and do not pull forward into earlier work.
