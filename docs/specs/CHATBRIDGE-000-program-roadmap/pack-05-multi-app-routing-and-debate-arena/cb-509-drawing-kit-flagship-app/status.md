# CB-509 Status

- status: validated
- pack: Pack 05 - Multi-App Routing and Debate Arena
- single-agent order: backfill 6 of 9
- blocked by: CB-506
- unblocks: CB-510
- implementation surfaces:
  - `src/shared/chatbridge/apps/drawing-kit.ts`
  - `src/shared/chatbridge/reviewed-app-launch.ts`
  - `src/shared/chatbridge/live-seeds.ts`
  - `src/renderer/packages/chatbridge/reviewed-app-launch.ts`
  - `src/renderer/packages/chatbridge/bridge/reviewed-app-runtime.ts`
  - `src/renderer/components/chatbridge/apps/ReviewedAppLaunchSurface.tsx`
  - `src/renderer/dev/chatbridgeManualSmoke.ts`
  - `test/integration/chatbridge/scenarios/drawing-kit-flagship.test.ts`
- validation surfaces:
  - `src/shared/chatbridge/apps/drawing-kit.test.ts`
  - `src/renderer/packages/chatbridge/reviewed-app-launch.test.ts`
  - `src/renderer/packages/chatbridge/bridge/reviewed-app-runtime.test.ts`
  - `src/shared/chatbridge/live-seeds.test.ts`
  - `src/renderer/dev/chatbridgeManualSmoke.test.ts`
  - `src/renderer/packages/initial_data.test.ts`
  - `src/renderer/packages/chatbridge/single-app-tools.test.ts`
  - `test/integration/chatbridge/scenarios/active-reviewed-catalog-transition.test.ts`
  - `test/integration/chatbridge/scenarios/live-reviewed-app-invocation.test.ts`
  - `test/integration/chatbridge/scenarios/drawing-kit-flagship.test.ts`
  - LangSmith project `chatbox-chatbridge`
  - repo gates:
    - `pnpm test`
    - `pnpm check`
    - `pnpm lint`
    - `pnpm build`
    - `git diff --check`
- happy-path scenario proof:
  - `test/integration/chatbridge/scenarios/drawing-kit-flagship.test.ts`
  - representative trace proof:
    - `chatbridge.eval.chatbridge-drawing-kit-flagship.cb-509-doc-proof-follow-up`
      -> `d88c0008-bfd7-4bf8-b9b9-b2fb9e860af6`
    - `chatbridge.manual_smoke.chatbridge-drawing-kit-doodle-dare.cb-509-doc-proof`
      -> `20eb050d-2450-42e1-97d7-225c9df2e782`
- failure or degraded proof:
  - `src/renderer/packages/chatbridge/reviewed-app-launch.test.ts`
  - `test/integration/chatbridge/scenarios/drawing-kit-flagship.test.ts`
  - representative trace proof:
    - `chatbridge.eval.chatbridge-drawing-kit-flagship.cb-509-doc-proof-recovery`
      -> `3c70b9ec-7563-492e-912f-79aa6ea28765`
- acceptance-criteria status:
  - AC-1 satisfied via the shared reviewed-launch contract plus the inline
    Drawing Kit runtime mounted through `ReviewedAppLaunchSurface`.
  - AC-2 satisfied via the bounded Drawing Kit snapshot/checkpoint model, the
    inline doodle-game runtime, and the supported `drawing-kit-doodle-dare`
    seed/manual-smoke fixture.
  - AC-3 satisfied via host-owned `summaryForModel` writes on checkpoint and
    completion, the follow-up context scenario proof, and checkpoint-preserving
    crash recovery.
- notes:
  - Opened from the active catalog change on 2026-04-02.
  - The approved Pencil direction is Variation A, `Sticker Sprint`, from the
    second-round doodle-game review packet.
  - The first Pencil review set was rejected because it still felt too
    product-like instead of game-like; the second round corrected that posture
    before any UI code landed.
  - The new supported desktop smoke path is `[Seeded] ChatBridge: Drawing Kit
    doodle dare`, which traces through LangSmith and stays inside `/dev/chatbridge`.
  - Focused TDD handoff state is recorded in
    `.ai/state/tdd-handoff/CB-509/pipeline-status.json`.
  - Full repo validation passed with `pnpm test`, `pnpm check`, `pnpm lint`,
    `pnpm build`, and `git diff --check`.
  - No direct `src/renderer/packages/initial_data.ts` edit was required because
    preset seeded examples already derive from `getChatBridgeLiveSeedFixtures()`;
    the new Drawing Kit seed now flows into the preset corpus automatically.
