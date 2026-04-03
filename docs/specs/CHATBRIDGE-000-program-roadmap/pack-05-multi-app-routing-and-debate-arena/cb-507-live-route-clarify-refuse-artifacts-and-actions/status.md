# CB-507 Status

- status: validated
- pack: Pack 05 - Multi-App Routing and Debate Arena
- single-agent order: backfill 8 of 9
- blocked by: CB-510
- unblocks: CB-105
- implementation surfaces:
  - `src/shared/chatbridge/routing.ts`
  - `src/renderer/packages/model-calls/stream-text.ts`
  - `src/renderer/packages/chatbridge/single-app-tools.ts`
  - `src/renderer/packages/chatbridge/router/actions.ts`
  - `src/renderer/components/chat/Message.tsx`
  - `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
  - `src/renderer/components/chatbridge/ChatBridgeRouteArtifact.tsx`
  - `src/renderer/components/chatbridge/chatbridge.ts`
  - `docs/specs/.../design-brief.md`
  - `docs/specs/.../design-research.md`
  - `docs/specs/.../design-decision.md`
- validation surfaces:
  - `src/renderer/packages/model-calls/stream-text.test.ts`
  - `src/renderer/packages/model-calls/index.test.ts`
  - `src/renderer/packages/chatbridge/router/actions.test.ts`
  - `src/renderer/components/chatbridge/ChatBridgeMessagePart.test.tsx`
  - `test/integration/chatbridge/scenarios/route-decision-artifacts.test.ts`
  - `test/integration/chatbridge/scenarios/route-decision-live-artifacts.test.ts`
  - LangSmith project `chatbox-chatbridge`
  - repo gates:
    - `pnpm test`
    - `pnpm check`
    - `pnpm lint`
    - `pnpm build`
    - `git diff --check`
- happy-path scenario proof:
  - `test/integration/chatbridge/scenarios/route-decision-live-artifacts.test.ts`
  - `src/renderer/packages/chatbridge/router/actions.test.ts`
  - representative trace proof:
    - `chatbridge.eval.chatbridge-route-decision-live-artifacts.cb-507-doc-proof-clarify`
      -> `ae3f678e-5089-483b-b5e8-8076b5a79dcc`
- failure or degraded proof:
  - `test/integration/chatbridge/scenarios/route-decision-live-artifacts.test.ts`
  - `src/renderer/packages/chatbridge/router/actions.test.ts`
  - representative trace proof:
    - `chatbridge.eval.chatbridge-route-decision-live-artifacts.cb-507-doc-proof-refuse`
      -> `efaa4331-7dc9-4984-a459-c6d0bad10b5f`
- acceptance-criteria status:
  - AC-1 satisfied via live route-artifact injection in
    `src/renderer/packages/model-calls/stream-text.ts`, durable receipt state in
    `src/shared/chatbridge/routing.ts`, and dedicated inline rendering through
    `ChatBridgeMessagePart` plus `ChatBridgeRouteArtifact`.
  - AC-2 satisfied via explicit refusal/chat-only receipts, replay-safe state
    persistence, and the refusal scenario proof in
    `route-decision-live-artifacts.test.ts`.
  - AC-3 satisfied via host-owned clarify actions in
    `src/renderer/packages/chatbridge/router/actions.ts`, reviewed-launch reuse
    through `upsertReviewedAppLaunchParts(...)`, and stale replay rejection in
    `actions.test.ts`.
- notes:
  - Opened from `smoke-audit-master.md` finding SA-003.
  - The workspace autonomous UI lane replaced the older Pencil-only note in the
    original packet. `design-brief.md`, `design-research.md`, and
    `design-decision.md` are the checked-in UI artifacts for this story.
  - The chosen direction is Option C, `Conversation receipt with option cards`,
    from `design-decision.md`.
  - Focused TDD handoff state is recorded in
    `.ai/state/tdd-handoff/CB-507/pipeline-status.json`.
  - Full repo validation passed with `pnpm test`, `pnpm check`, `pnpm lint`,
    `pnpm build`, and `git diff --check`.
  - No direct `src/renderer/packages/initial_data.ts` edit was required because
    CB-507 changes the live route-artifact UI path, not the seeded fixture
    corpus.
  - `CB-505` is legacy and not part of the active dependency chain.
