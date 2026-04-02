# CB-508 Status

- status: validated
- pack: Pack 05 - Multi-App Routing and Debate Arena
- single-agent order: backfill 4 of 9
- blocked by: CB-305
- unblocks: CB-506
- implementation surfaces:
  - `docs/specs/CHATBRIDGE-000-program-roadmap/`
  - `chatbridge/PRESEARCH.md`
  - `chatbridge/ARCHITECTURE.md`
  - `chatbridge/EVALS_AND_OBSERVABILITY.md`
  - `src/shared/chatbridge/reviewed-app-catalog.ts`
  - `src/shared/chatbridge/live-seeds.ts`
  - `src/renderer/packages/initial_data.ts`
  - `src/renderer/components/dev/ChatBridgeSeedLab.tsx`
- validation surfaces:
  - `src/shared/chatbridge/reviewed-app-catalog.test.ts`
  - `src/shared/chatbridge/live-seeds.test.ts`
  - `src/renderer/packages/initial_data.test.ts`
  - `src/renderer/setup/preset_sessions.test.ts`
  - `src/renderer/components/dev/ChatBridgeSeedLab.test.tsx`
  - `test/integration/chatbridge/scenarios/active-reviewed-catalog-transition.test.ts`
- happy-path scenario proof:
  - `test/integration/chatbridge/scenarios/active-reviewed-catalog-transition.test.ts`
  - trace: `chatbridge.eval.chatbridge-active-reviewed-catalog-transition-cb-508-doc-proof`
    -> `b54ae68a-7aa2-43a4-ad16-a7064f525bd7`
- failure or degraded proof:
  - `src/shared/chatbridge/reviewed-app-catalog.test.ts`
  - `src/shared/chatbridge/live-seeds.test.ts`
  - `src/renderer/packages/initial_data.test.ts`
- acceptance-criteria status:
  - AC-1 satisfied via the default reviewed catalog transition to Chess,
    Drawing Kit, and Weather Dashboard
  - AC-2 satisfied via explicit legacy-reference helpers and seed inspection
    labels for Debate Arena and Story Builder
  - AC-3 satisfied via progress, pack status, pack README, smoke ledger, and
    architecture/presearch updates aligned to the new queue
- notes:
  - Opened from the product-direction change on 2026-04-02.
  - Default runtime registration now stops at the active trio; live non-Chess
    launch execution is still deferred to `CB-506`, `CB-509`, and `CB-510`.
  - The seed corpus now classifies fixtures as `active-flagship`,
    `platform-regression`, or `legacy-reference`; `history-and-preview`
    remains available, but only as a legacy Story Builder reference.
  - Debate Arena and Story Builder remain legacy references and are not active
    queue dependencies.
