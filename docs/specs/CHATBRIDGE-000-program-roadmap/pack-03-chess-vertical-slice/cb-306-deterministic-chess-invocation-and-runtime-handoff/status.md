# CB-306 Status

- status: validated
- owner: Codex
- pack: Pack 03 - Chess Vertical Slice
- depends_on:
  - CB-305
- unblocks:
  - clearer user verification of the Chess app path before broader Pack 05 work
  - narrowing `CB-506` back to true multi-app/live-invocation scope
- code paths:
  - `src/shared/chatbridge/single-app-discovery.ts`
  - `src/renderer/packages/chatbridge/reviewed-app-launch.ts`
  - `src/shared/chatbridge/apps/chess.ts`
- test paths:
  - `src/shared/chatbridge/single-app-discovery.test.ts`
  - `src/renderer/packages/chatbridge/reviewed-app-launch.test.ts`
  - `test/integration/chatbridge/scenarios/chess-reviewed-runtime-handoff.test.tsx`
- manual proof:
  - Repro target: explicit Chess tool invocation now shows the Chess board instead of the reviewed bridge placeholder shell, and invalid board input fails closed without promoting a fake board state.
- gaps:
  - No seeded example refresh required; this backfill changes live runtime normalization rather than the seeded session corpus.
  - Pack 05 still remains open for multi-app live invocation, Drawing Kit, Weather, and clarify/refuse.

## Acceptance-Criteria Status

- AC-1: complete
- AC-2: complete
- AC-3: complete
- AC-4: complete
- AC-5: complete
