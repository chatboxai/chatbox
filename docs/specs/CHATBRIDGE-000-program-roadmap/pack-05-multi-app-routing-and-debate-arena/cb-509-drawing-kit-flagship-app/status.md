# CB-509 Status

- status: planned
- pack: Pack 05 - Multi-App Routing and Debate Arena
- single-agent order: backfill 5 of 8
- blocked by: CB-508, CB-506
- unblocks: CB-507
- implementation surfaces:
  - `src/shared/chatbridge/`
  - `src/renderer/components/chatbridge/apps/`
  - `src/renderer/packages/chatbridge/`
  - `design/stories/`
  - `test/integration/chatbridge/scenarios/`
- validation surfaces:
  - Drawing Kit contract tests
  - inline runtime integration tests
  - manual smoke traces for Drawing Kit launch and follow-up chat
- happy-path scenario proof:
  - planned: Drawing Kit launches inline, supports drawing interaction, and
    leaves a host-owned summary for later chat turns
- failure or degraded proof:
  - planned: malformed drawing state or local persistence failure degrades
    through host-owned recovery without losing the chat thread
- acceptance-criteria status:
  - AC-1 planned
  - AC-2 planned
  - AC-3 planned
- notes:
  - Opened from the active catalog change on 2026-04-02.
  - This story requires Pencil approval before UI implementation.
