# CB-510 Status

- status: planned
- pack: Pack 05 - Multi-App Routing and Debate Arena
- single-agent order: backfill 6 of 8
- blocked by: CB-508, CB-506
- unblocks: CB-507
- implementation surfaces:
  - `src/shared/chatbridge/`
  - `src/main/chatbridge/`
  - `src/renderer/components/chatbridge/apps/`
  - `src/renderer/packages/chatbridge/`
  - `design/stories/`
  - `test/integration/chatbridge/scenarios/`
- validation surfaces:
  - weather contract tests
  - inline runtime integration tests
  - manual smoke traces for weather launch, refresh, and degraded upstream states
- happy-path scenario proof:
  - planned: Weather Dashboard launches inline, renders host-owned weather
    data, and leaves a summary for later chat turns
- failure or degraded proof:
  - planned: upstream timeout, bad response, or missing location remain visible,
    recoverable, and host-owned without any user-auth path
- acceptance-criteria status:
  - AC-1 planned
  - AC-2 planned
  - AC-3 planned
- notes:
  - Opened from the active catalog change on 2026-04-02.
  - This story requires Pencil approval before UI implementation.
