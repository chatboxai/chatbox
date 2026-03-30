# CB-303 Feature Spec

## Metadata

- Story ID: CB-303
- Story Title: Mid-game assistant reasoning with live board context
- Author: Codex
- Date: 2026-03-30
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 03 - Chess Vertical Slice

## Problem Statement

The core product promise is that the assistant stays aware of app state. Chess needs to prove that a mid-game question uses the current board context rather than generic chess advice.

## Story Pack Objectives

- Higher-level pack goal: Use Chess as the first flagship app because it forces long-lived state, visible in-thread interaction, mid-game reasoning, and reliable completion behavior.
- Pack primary objectives: O1, O2
- How this story contributes to the pack: Mid-game follow-up questions incorporate current board context in the model path.

## User Stories

- As a user, I want to ask for help mid-game and get advice based on the actual board position.
- As the host, I want app context injection to be explicit and bounded so the assistant does not depend on raw partner internals.

## Acceptance Criteria

- [ ] AC-1: Mid-game follow-up questions incorporate current board context in the model path.
- [ ] AC-2: The context passed to the model is host-owned and normalized, not raw partner prose.
- [ ] AC-3: The conversation remains usable if current board context is stale or unavailable.

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

- No dedicated visible UI scope beyond existing host surfaces unless noted in later implementation.

## Out of Scope

- Final completion summaries
- Other flagship apps

## Done Definition

- The accepted behavior is implemented against the existing repo seams.
- Tests cover the primary happy path and the important failure mode for this story.
- Validation passes for the touched scope.
- Any new visible UI state has approved Pencil evidence before code if applicable.
