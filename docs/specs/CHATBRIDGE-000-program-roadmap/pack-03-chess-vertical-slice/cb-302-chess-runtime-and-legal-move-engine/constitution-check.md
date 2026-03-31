# CB-302 Constitution Check

## Story Context

- Story ID: CB-302
- Story Title: Chess runtime and legal move engine
- Pack: Pack 03 - Chess Vertical Slice
- Owner: Codex
- Date: 2026-03-30

## Constraints

1. Keep this story aligned with the ChatBridge architecture and presearch rather than inventing a parallel platform shape.
Source: `chatbridge/PRESEARCH.md`, `chatbridge/ARCHITECTURE.md`
2. Follow the repo's four-artifact story contract for standard-lane work.
Source: `.ai/skills/spec-driven-development.md`
3. Extend current Chatbox seams rather than bypassing them with isolated prototypes.
Sources: `src/renderer/components/chatbridge/apps/chess/`, `src/renderer/packages/chatbridge/bridge/`, `test/integration/chatbridge/`
4. Preserve the repo's validation baseline when implementation begins.
Source: `package.json`
5. Keep ChatBridge host authority explicit for lifecycle, routing, and model-visible memory.
Source: `chatbridge/PRESEARCH.md`
6. Visible UI changes require Pencil MCP review and explicit approval before code.
Sources: `.ai/docs/PENCIL_UI_WORKFLOW.md`, `.ai/workflows/pencil-ui-design.md`

## Structural Map

- Actual surface: `src/shared/chatbridge/apps/chess.ts`
- Actual surface: `src/shared/chatbridge/app-records.ts`
- Actual surface: `src/shared/types/session.ts`
- Actual surface: `src/renderer/components/chatbridge/apps/chess/`
- Actual surface: `src/renderer/packages/chatbridge/chess-session-state.ts`
- Actual surface: `src/shared/chatbridge/live-seeds.ts`
- Actual surface: `design/stories/CB-302.pen`

## Exemplars

1. `src/shared/types/session.ts`
Shared schema precedent for durable conversation state.
2. `src/renderer/components/chat/Message.tsx`
Timeline rendering precedent for new conversation artifacts.
3. `src/renderer/packages/model-calls/stream-text.ts`
Current orchestration/tool-call precedent for host-controlled execution.
4. `src/renderer/components/Artifact.tsx`
Current embedded surface precedent for future host-owned runtime containers.

## Lane Decision

- Lane: `standard`
- Why: this story changes shared contracts, runtime boundaries, or cross-cutting behavior that affects multiple code paths.
- Required gates: constitution check, feature spec, technical plan, task breakdown, focused TDD during implementation, and Pencil review before UI code.

## Completion Evidence

- Approved visible direction:
  - `design/stories/CB-302.pen`
  - `docs/specs/CHATBRIDGE-000-program-roadmap/pack-03-chess-vertical-slice/cb-302-chess-runtime-and-legal-move-engine/pencil-review.md`
- Shared contracts and persisted host-owned state:
  - `src/shared/chatbridge/apps/chess.ts`
  - `src/shared/chatbridge/app-records.ts`
  - `src/shared/types/session.ts`
- Renderer runtime and message-shell integration:
  - `src/renderer/components/chatbridge/apps/chess/ChessRuntime.tsx`
  - `src/renderer/packages/chatbridge/chess-session-state.ts`
  - `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
  - `src/renderer/components/chatbridge/chatbridge.ts`
  - `src/renderer/components/chat/Message.tsx`
- Live seeded inspection path:
  - `src/shared/chatbridge/live-seeds.ts`
  - `src/renderer/dev/chatbridgeSeeds.ts`
  - `src/renderer/components/dev/ChatBridgeSeedLab.tsx`
- Focused tests added:
  - `src/shared/chatbridge/apps/chess.test.ts`
  - `src/renderer/packages/chatbridge/chess-session-state.test.ts`
  - `src/renderer/components/chatbridge/apps/chess/ChessRuntime.test.tsx`
  - `src/shared/chatbridge/live-seeds.test.ts`
