# CB-702 Status

- status: validated
- pack: Pack 07 - Error Handling, Safety, and Partner DX
- single-agent order: 4 of 5
- blocked by: CB-705 at least `validated`
- unblocks: CB-704
- implementation surfaces:
  - `src/shared/chatbridge/observability.ts`
  - `src/shared/chatbridge/eligibility.ts`
  - `src/shared/chatbridge/index.ts`
  - `src/renderer/packages/chatbridge/bridge/host-controller.ts`
- validation surfaces:
  - `src/shared/chatbridge/observability.test.ts`
  - `src/shared/chatbridge/eligibility.test.ts`
  - `src/renderer/packages/chatbridge/router/candidates.test.ts`
  - `test/integration/chatbridge/scenarios/operator-controls-rollout.test.ts`
- happy-path scenario proof:
  `test/integration/chatbridge/scenarios/operator-controls-rollout.test.ts`
- failure or degraded proof:
  `src/shared/chatbridge/observability.test.ts`
- acceptance-criteria status:
  - AC-1 complete: lifecycle and recovery signals now emit normalized
    observability events and derive per-app health records.
  - AC-2 complete: app-wide and version-scoped kill switches now block new
    reviewed-app launches at runtime.
  - AC-3 complete: active-session behavior is now explicit as either
    `allow-to-complete` or `recover-inline` when a kill switch is active.
- notes:
  - The story stays inside host-owned contracts and routing seams; it does not
    add an operator dashboard UI.
  - No `src/renderer/packages/initial_data.ts` refresh was required because
    CB-702 adds runtime observability and control contracts rather than a new
    seeded visible shell state.
