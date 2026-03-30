# CB-301 Feature Spec

## Metadata

- Story ID: CB-301
- Story Title: In-thread app launch and rendering flow
- Author: Codex
- Date: 2026-03-30
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 03 - Chess Vertical Slice

## Problem Statement

The platform needs to prove that a reviewed app can launch from a natural-language request and appear inside the conversation through the host-owned app container.

## Story Pack Objectives

- Higher-level pack goal: Use Chess as the first flagship app because it forces long-lived state, visible in-thread interaction, mid-game reasoning, and reliable completion behavior.
- Pack primary objectives: O1, O2
- How this story contributes to the pack: A natural-language Chess request can trigger the host-owned app launch path.

## User Stories

- As a user, I want Chess to open inside the thread when I ask to play so the conversation feels continuous.
- As the host, I want app launch to look like a governed platform action rather than an ad hoc iframe injection.

## Acceptance Criteria

- [ ] AC-1: A natural-language Chess request can trigger the host-owned app launch path.
- [ ] AC-2: The timeline renders the embedded Chess experience through the approved app container states.
- [ ] AC-3: Active session state and app instance linkage are visible to the host runtime.

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

- The chess move engine itself
- Completion normalization

## Done Definition

- The accepted behavior is implemented against the existing repo seams.
- Tests cover the primary happy path and the important failure mode for this story.
- Validation passes for the touched scope.
- Any new visible UI state has approved Pencil evidence before code if applicable.
