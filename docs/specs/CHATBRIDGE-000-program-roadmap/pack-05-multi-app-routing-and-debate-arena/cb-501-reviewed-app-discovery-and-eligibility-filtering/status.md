# CB-501 Status

- status: validated
- pack: Pack 05 - Multi-App Routing and Debate Arena
- single-agent order: 1 of 4
- blocked by: none
- unblocks: CB-502
- implementation surfaces:
  - `src/shared/chatbridge/eligibility.ts`
  - `src/shared/chatbridge/index.ts`
  - `src/renderer/packages/chatbridge/router/candidates.ts`
  - `src/renderer/packages/chatbridge/router/index.ts`
- validation surfaces:
  - `src/shared/chatbridge/eligibility.test.ts`
  - `src/renderer/packages/chatbridge/router/candidates.test.ts`
  - `test/integration/chatbridge/scenarios/reviewed-app-eligibility.test.ts`
- happy-path scenario proof:
  - `test/integration/chatbridge/scenarios/reviewed-app-eligibility.test.ts`
    proves the router-facing candidate list exposes only reviewed apps whose
    host context, approval state, and required permissions match.
- failure or degraded proof:
  - `src/shared/chatbridge/eligibility.test.ts` proves invalid host context
    fails closed and explains the rejection with `invalid-context`.
  - `src/renderer/packages/chatbridge/router/candidates.test.ts` proves denied
    apps stay out of the router candidate list with explicit reason codes.
- acceptance-criteria status:
  - AC-1 validated
  - AC-2 validated
  - AC-3 validated
- notes: Start Pack 5 by proving reviewed-app eligibility before any clarify or
  refusal behavior is layered on top. No `initial_data.ts` refresh was needed
  for this story because the repo still has no seeded ChatBridge multi-app
  session example to update yet.
