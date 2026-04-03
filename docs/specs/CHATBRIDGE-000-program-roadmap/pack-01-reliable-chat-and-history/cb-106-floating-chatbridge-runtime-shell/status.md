# CB-106 Status

- status: merged
- owner: Codex
- pack: Pack 01 - Reliable Chat and History
- depends_on:
  - CB-103
  - CB-305
  - CB-306
- unblocks:
  - aligned Pack 05 runtime UX for Drawing Kit and Weather
  - keeping active app control visible while the user continues chatting
- code paths:
  - `src/renderer/routes/session/$sessionId.tsx`
  - `src/renderer/components/chatbridge/`
  - `src/renderer/stores/uiStore.ts`
- test paths:
  - `src/renderer/components/chatbridge/**/*.test.tsx`
  - `src/renderer/routes/session/**/*.test.tsx`
  - `test/integration/chatbridge/scenarios/`
- manual proof:
  - target behavior: when a user continues chatting after launching a ChatBridge
    app, the live runtime remains visible in a floating host shell instead of
    disappearing into scrollback
- gaps:
  - The Pencil doc sync script currently fails in the clean worktree because
    `bs4` is missing; use the checked-in Pencil snapshot plus MCP unless that
    bootstrap issue is fixed in scope.
  - No additional seeded example-data refresh was required because the visible
    change is a renderer shell promotion of existing app parts, not a change to
    the seeded ChatBridge message corpus.

## Acceptance-Criteria Status

- AC-1: complete
- AC-2: complete
- AC-3: complete
- AC-4: complete
- AC-5: complete
- AC-6: complete
