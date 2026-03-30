# CB-304 Feature Spec

## Metadata

- Story ID: CB-304
- Story Title: Completion, resume, and end-of-game summary
- Author: Codex
- Date: 2026-03-30
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 03 - Chess Vertical Slice

## Problem Statement

The spec explicitly warns that completion signaling is where teams fail. Chess must prove end-of-game completion, resume semantics, and post-game discussion work reliably.

## Story Pack Objectives

- Higher-level pack goal: Use Chess as the first flagship app because it forces long-lived state, visible in-thread interaction, mid-game reasoning, and reliable completion behavior.
- Pack primary objectives: O1, O2
- How this story contributes to the pack: End-of-game completion is emitted as an explicit host-recognized event.

## User Stories

- As a user, I want the chat to understand when the game ended and talk about the result afterward.
- As the host, I want completion and resume semantics to be explicit so interrupted sessions can recover safely.

## Acceptance Criteria

- [ ] AC-1: End-of-game completion is emitted as an explicit host-recognized event.
- [ ] AC-2: The host can resume or explain interrupted Chess sessions coherently.
- [ ] AC-3: A structured post-game summary exists for later discussion turns.

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

- Debate Arena or Story Builder
- Tenant policy controls

## Done Definition

- The accepted behavior is implemented against the existing repo seams.
- Tests cover the primary happy path and the important failure mode for this story.
- Validation passes for the touched scope.
- Any new visible UI state has approved Pencil evidence before code if applicable.
