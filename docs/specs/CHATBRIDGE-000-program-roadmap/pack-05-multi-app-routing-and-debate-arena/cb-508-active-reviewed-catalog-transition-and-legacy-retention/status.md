# CB-508 Status

- status: planned
- pack: Pack 05 - Multi-App Routing and Debate Arena
- single-agent order: backfill 3 of 8
- blocked by: CB-006, CB-305
- unblocks: CB-506, CB-509, CB-510, CB-507
- implementation surfaces:
  - `docs/specs/CHATBRIDGE-000-program-roadmap/`
  - `chatbridge/PRESEARCH.md`
  - `chatbridge/ARCHITECTURE.md`
  - `src/shared/chatbridge/reviewed-app-catalog.ts`
  - `src/shared/chatbridge/live-seeds.ts`
  - `src/renderer/packages/initial_data.ts`
- validation surfaces:
  - reviewed catalog tests
  - seed and preset session coverage
  - roadmap and smoke-audit docs
- happy-path scenario proof:
  - planned: the default active runtime and local seeds expose Chess, Drawing
    Kit, and Weather as the flagship set
- failure or degraded proof:
  - planned: legacy Debate Arena and Story Builder remain excluded from the
    active default catalog without being deleted from the repo
- acceptance-criteria status:
  - AC-1 planned
  - AC-2 planned
  - AC-3 planned
- notes:
  - Opened from the product-direction change on 2026-04-02.
  - This story should land before new flagship app implementation so the queue
    stops targeting legacy apps.
