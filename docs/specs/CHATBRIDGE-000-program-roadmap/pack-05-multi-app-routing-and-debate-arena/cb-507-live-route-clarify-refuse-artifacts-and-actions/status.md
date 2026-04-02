# CB-507 Status

- status: planned
- pack: Pack 05 - Multi-App Routing and Debate Arena
- single-agent order: backfill 7 of 8
- blocked by: CB-510
- unblocks: CB-105
- implementation surfaces:
  - `src/shared/chatbridge/routing.ts`
  - `src/renderer/packages/chatbridge/router/decision.ts`
  - `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
  - `src/renderer/components/chatbridge/chatbridge.ts`
  - `src/renderer/components/chat/Message.tsx`
  - `design/stories/`
- validation surfaces:
  - `test/integration/chatbridge/scenarios/route-decision-artifacts.test.ts`
  - live ambiguous/chat-only prompt smoke
  - LangSmith route-decision traces
- happy-path scenario proof:
  - planned: an ambiguous prompt renders a clarify artifact and a user choice
    launches through host-owned route state
- failure or degraded proof:
  - planned: chat-only and stale-choice cases render refusal or disabled-action
    behavior without accidental app launch
- acceptance-criteria status:
  - AC-1 planned
  - AC-2 planned
  - AC-3 planned
- notes:
  - Opened from `smoke-audit-master.md` finding SA-003.
  - This story requires Pencil approval before UI implementation because it
    introduces user-visible route artifacts.
  - `CB-505` is legacy and not part of the active dependency chain.
