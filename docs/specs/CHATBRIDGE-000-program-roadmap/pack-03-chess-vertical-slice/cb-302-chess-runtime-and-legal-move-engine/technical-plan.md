# CB-302 Technical Plan

## Metadata

- Story ID: CB-302
- Story Title: Chess runtime and legal move engine
- Author: Codex
- Date: 2026-03-31

## Proposed Design

- Components/modules affected:
- `src/renderer/components/chatbridge/apps/chess/`
- `src/renderer/packages/chatbridge/`
- `src/shared/chatbridge/`
- `src/shared/types/session.ts`
- `src/renderer/components/chatbridge/`
- `src/renderer/components/chat/Message.tsx`
- `src/shared/chatbridge/live-seeds.ts`
- `test/integration/chatbridge/`
- `design/stories/`
- Public interfaces/contracts:
- Board state update contract
- Move submission and validation behavior
- Runtime -> host state event shape
- Data flow summary:
  User interacts with the inline chess board -> the runtime validates the move with `chess.js` -> the host persists the normalized chess snapshot onto the message app part and session app-record store -> the same board reloads from that persisted state in the live session.

## Architecture Decisions

- Decision:
  Build Chess as a real stateful runtime that speaks the host contract instead of a passive visual board.
- Alternatives considered:
- Use a static board demo only
- Keep board state purely local to the component tree
- Wait for CB-301 launch plumbing to land before proving any playable runtime surface
- Rationale:
  Chess is the proof that ChatBridge can handle long-lived interactive state, not just embedded visuals, and the existing live seed/message shell seam on `main` is the smallest real surface available while CB-301 remains unmerged.

## Data Model / API Contracts

- Request shape:
  Inputs should follow the contracts above and be validated before any host-side state transition.
- Response shape:
  Outputs should be normalized into host-owned records or timeline artifacts rather than ad hoc partner payloads.
- Storage/index changes:
  This story should update only the specific host/session/runtime records it needs and keep the broader ChatBridge model forward-compatible.

## Dependency Plan

- Existing dependencies used:
  current Chatbox session schema, renderer/timeline patterns, ChatBridge shell/message seams, and live seed storage helpers
- New dependencies proposed (if any):
  `chess.js` for legal move generation, game-state validation, and FEN/PGN state derivation across both the legacy mid-game snapshot path and the new persisted runtime path
- Risk and mitigation:
  keep the work inside existing seams, persist board state through the host-owned session model, and add targeted UI plus persistence tests before broader launch-flow work

## Test Strategy

- Unit tests:
- Legal/illegal move behavior
- Board state propagation to host runtime
- Runtime stability inside container lifecycle states
- Integration tests:
  cover the full host/runtime path touched by this story rather than only isolated helpers
- E2E or smoke tests:
  add a focused smoke path if the story changes user-visible app flow or session continuity
- Edge-case coverage mapping:
  stale state, malformed inputs, and degraded fallback behavior should be covered explicitly

## UI Implementation Plan

- Behavior logic modules:
  chess legality, snapshot normalization, and session persistence should live outside presentational UI components
- Component structure:
  use the approved Variation A board-first runtime layout inside the existing host-owned ChatBridge shell
- Accessibility implementation plan:
  render board squares as labeled buttons, keep result text readable in DOM order, and preserve status messaging beneath the board
- Visual regression capture plan:
  preserve the approved Pencil artifact for the board-first runtime and expose a live seeded session for manual audit in `/dev/chatbridge`

## Implementation Evidence

- Shared chess contract and persisted app-record schema:
  - `src/shared/chatbridge/apps/chess.ts`
  - `src/shared/chatbridge/app-records.ts`
  - `src/shared/types/session.ts`
- Renderer runtime and host-owned update path:
  - `src/renderer/components/chatbridge/apps/chess/ChessRuntime.tsx`
  - `src/renderer/packages/chatbridge/chess-session-state.ts`
  - `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
  - `src/renderer/components/chatbridge/chatbridge.ts`
  - `src/renderer/components/chat/Message.tsx`
- Live seed inspection path:
  - `src/shared/chatbridge/live-seeds.ts`
  - `src/renderer/dev/chatbridgeSeeds.ts`
  - `src/renderer/components/dev/ChatBridgeSeedLab.tsx`
- Focused validation added:
  - `src/shared/chatbridge/apps/chess.test.ts`
  - `src/renderer/packages/chatbridge/chess-session-state.test.ts`
  - `src/renderer/components/chatbridge/apps/chess/ChessRuntime.test.tsx`
  - `src/shared/chatbridge/live-seeds.test.ts`
  - `src/renderer/dev/chatbridgeSeeds.test.ts`
  - `src/renderer/components/dev/ChatBridgeSeedLab.test.tsx`
  - `src/renderer/components/chat/Message.chatbridge.test.tsx`

## Validation Outcome

- Focused CB-302 regression coverage passed under Node `20.20.0`:
  `pnpm exec vitest run src/shared/chatbridge/apps/chess.test.ts src/renderer/packages/chatbridge/chess-session-state.test.ts src/renderer/components/chatbridge/apps/chess/ChessRuntime.test.tsx src/shared/chatbridge/live-seeds.test.ts src/renderer/dev/chatbridgeSeeds.test.ts src/renderer/components/dev/ChatBridgeSeedLab.test.tsx src/shared/types.test.ts src/renderer/components/chat/Message.chatbridge.test.tsx`
- `pnpm test` passed.
- `pnpm check` passed.
- `pnpm lint` passed.
- `pnpm build` passed.
- `git diff --check` passed.

## Rollout and Risk Mitigation

- Rollback strategy:
  keep the change behind the story boundary and prefer reversible schema/runtime updates where practical
- Feature flags/toggles:
  use a targeted toggle if the change affects active user flows or partner-runtime exposure
- Observability checks:
  ensure the new path emits enough structured state to debug launch, failure, and recovery behavior

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
