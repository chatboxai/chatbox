# CB-302 Feature Spec

## Metadata

- Story ID: CB-302
- Story Title: Chess runtime and legal move engine
- Author: Codex
- Date: 2026-03-30
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 03 - Chess Vertical Slice

## Problem Statement

Chess needs a real interactive runtime with board state and legal move validation so the assistant is reasoning over actual game state, not a toy surface.

## Story Pack Objectives

- Higher-level pack goal: Use Chess as the first flagship app because it forces long-lived state, visible in-thread interaction, mid-game reasoning, and reliable completion behavior.
- Pack primary objectives: O1, O2
- How this story contributes to the pack: The chess runtime can render board state, accept moves, and reject illegal ones.

## User Stories

- As a user, I want a playable chess board inside chat with valid moves and clear feedback.
- As the host, I want the app runtime to emit reliable state updates rather than opaque UI mutations.

## Acceptance Criteria

- [x] AC-1: The chess runtime can render board state, accept moves, and reject illegal ones.
- [x] AC-2: Board updates are emitted to the host as structured state changes.
- [x] AC-3: The app remains coherent inside the host-owned container and lifecycle contract.

## Edge Cases

- Empty/null inputs: host behavior must stay explicit even when the story receives partial or absent runtime data.
- Boundary values: stale state, repeated events, or session reloads must have a documented behavior.
- Invalid/malformed data: validation should fail closed rather than accepting malformed app/platform inputs.
- External-service failures: degraded behavior must keep the conversation usable when network, partner, or storage edges fail.

## Non-Functional Requirements

- Security: preserve host authority and validate all new inputs/contracts.
- Performance: avoid blocking streaming or session responsiveness with the new path.
- Observability: emit enough structured state to debug failures in this story's boundary.
- Reliability: degraded and retry behavior must be explicit where applicable.

## UI Requirements

- Behavior and visual work remain separated.
- This story must run through the Pencil MCP workflow after spec and technical planning and before UI code lands.
- Approved design-system patterns and tokens must be used instead of hardcoded visuals.

## Out of Scope

- Multi-app routing
- Partner auth

## Done Definition

- The accepted behavior is implemented against the existing repo seams.
- Tests cover the primary happy path and the important failure mode for this story.
- Validation passes for the touched scope.
- Any new visible UI state has approved Pencil evidence before code if applicable.

## Implementation Evidence

- Shared chess contract and persisted snapshot shape:
  - `src/shared/chatbridge/apps/chess.ts`
  - `src/shared/chatbridge/app-records.ts`
  - `src/shared/types/session.ts`
- Renderer runtime and host-owned persistence:
  - `src/renderer/components/chatbridge/apps/chess/ChessRuntime.tsx`
  - `src/renderer/packages/chatbridge/chess-session-state.ts`
  - `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
  - `src/renderer/components/chatbridge/chatbridge.ts`
  - `src/renderer/components/chat/Message.tsx`
- Live inspection path updated for this story:
  - `src/shared/chatbridge/live-seeds.ts`
  - `src/renderer/dev/chatbridgeSeeds.ts`
  - `src/renderer/components/dev/ChatBridgeSeedLab.tsx`
- Focused regression coverage:
  - `src/shared/chatbridge/apps/chess.test.ts`
  - `src/renderer/packages/chatbridge/chess-session-state.test.ts`
  - `src/renderer/components/chatbridge/apps/chess/ChessRuntime.test.tsx`
  - `src/shared/chatbridge/live-seeds.test.ts`
  - `src/renderer/dev/chatbridgeSeeds.test.ts`
- The seeded Chess mid-game fixture remains available for bounded reasoning checks, and the new seeded Chess runtime fixture persists host-owned board updates in-thread.
