# CB-505 Status

- status: planned
- pack: Pack 05 - Multi-App Routing and Debate Arena
- single-agent order: parked legacy packet
- blocked by: CB-006
- unblocks: CB-506, CB-507
- implementation surfaces:
  - `src/shared/chatbridge/reviewed-app-catalog.ts`
  - `src/shared/chatbridge/index.ts`
  - `src/renderer/packages/chatbridge/router/candidates.ts`
  - `src/renderer/packages/chatbridge/router/decision.ts`
  - `src/renderer/packages/chatbridge/single-app-tools.ts`
- validation surfaces:
  - `src/shared/chatbridge/`
  - `test/integration/chatbridge/scenarios/`
  - fresh-thread smoke checks for Story Builder and Debate Arena
- happy-path scenario proof:
  - planned: the default runtime sees the approved flagship apps as reviewed
    candidates without seed-only overrides
- failure or degraded proof:
  - planned: malformed or missing catalog entries fail validation with explicit
    reason codes instead of disappearing silently
- acceptance-criteria status:
  - AC-1 planned
  - AC-2 planned
  - AC-3 planned
- notes:
  - Opened from `smoke-audit-master.md` finding SA-001.
  - This packet is now parked in favor of `CB-508`, which transitions the
    active flagship catalog to Chess, Drawing Kit, and Weather while keeping
    Debate Arena and Story Builder as legacy references.
