# CB-701 Status

- status: validated
- pack: Pack 07 - Error Handling, Safety, and Partner DX
- single-agent order: 1 of 5
- blocked by: none
- unblocks: CB-703
- implementation surfaces:
  - `src/shared/chatbridge/policy.ts`
  - `src/shared/chatbridge/eligibility.ts`
  - `src/shared/chatbridge/index.ts`
- validation surfaces:
  - `src/shared/chatbridge/policy.test.ts`
  - `src/shared/chatbridge/eligibility.test.ts`
  - `test/integration/chatbridge/scenarios/policy-precedence-routing.test.ts`
  - `src/renderer/packages/chatbridge/router/candidates.test.ts`
  - `test/integration/chatbridge/scenarios/reviewed-app-eligibility.test.ts`
- happy-path scenario proof:
  `test/integration/chatbridge/scenarios/policy-precedence-routing.test.ts`
- failure or degraded proof:
  `test/integration/chatbridge/scenarios/policy-precedence-routing.test.ts`
- acceptance-criteria status:
  - AC-1 met: tenant, teacher, and classroom policy scopes now resolve through
    one validated host-owned precedence contract.
  - AC-2 met: stale policy snapshots fail closed and surface explicit
    exclusion reasons instead of silently routing anyway.
  - AC-3 met: reviewed-app eligibility now consumes policy decisions directly,
    so later governance stories build on one shared decision surface.
- notes:
  - No `src/renderer/packages/initial_data.ts` refresh was needed; this story
    only changes shared policy and eligibility contracts.
