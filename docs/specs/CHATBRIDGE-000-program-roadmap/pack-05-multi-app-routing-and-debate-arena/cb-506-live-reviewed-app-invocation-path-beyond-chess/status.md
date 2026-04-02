# CB-506 Status

- status: planned
- pack: Pack 05 - Multi-App Routing and Debate Arena
- single-agent order: backfill 5 of 9
- blocked by: CB-508
- unblocks: CB-509
- implementation surfaces:
  - `src/renderer/packages/model-calls/stream-text.ts`
  - `src/renderer/packages/chatbridge/single-app-tools.ts`
  - `src/renderer/packages/chatbridge/router/decision.ts`
  - `src/renderer/packages/chatbridge/router/`
  - `src/renderer/components/chatbridge/`
- validation surfaces:
  - `test/integration/chatbridge/scenarios/`
  - fresh-thread prompt smoke for reviewed apps
  - LangSmith invoke-path traces
- happy-path scenario proof:
  - planned: the live runtime handles natural Chess prompts correctly and a
    fresh prompt can also launch an eligible non-Chess reviewed app through the
    reviewed invocation path
- failure or degraded proof:
  - planned: invoke-path launch failures remain explicit, traceable, and do not
    collapse into silent chat-only behavior
- acceptance-criteria status:
  - AC-1 planned
  - AC-2 planned
  - AC-3 planned
  - AC-4 planned
- notes:
  - Opened from `smoke-audit-master.md` finding SA-002.
  - This story replaces the live Chess-only shortcut after catalog parity and
    bridge runtime adoption are in place.
  - `CB-505` is legacy and should not be treated as an active prerequisite.
  - The delta smoke pass showed that common Chess prompts such as opening
    analysis and raw FEN input still fall through the live path incorrectly.
