# CB-103 Feature Spec

## Metadata

- Story ID: CB-103
- Story Title: Host-owned app container shell
- Author: Codex
- Date: 2026-03-30
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 01 - Reliable Chat and History

## Problem Statement

The current Artifact surface is an iframe preview for generated HTML, not a governed embedded runtime surface. ChatBridge needs a host-owned app shell with loading, ready, active, complete, and fallback states.

## Story Pack Objectives

- Higher-level pack goal: Stabilize the current chat/session substrate so app-backed artifacts can live inside a thread without breaking persistence, export, or recovery semantics.
- Pack primary objectives: O1, O2
- How this story contributes to the pack: A dedicated host-owned app container exists as the canonical UI seam for embedded app experiences.

## User Stories

- As a user, I want embedded apps to feel like part of the conversation rather than a raw preview panel.
- As the host, I want one container abstraction that can later support native apps, iframes, and recoverable failure states.

## Acceptance Criteria

- [ ] AC-1: A dedicated host-owned app container exists as the canonical UI seam for embedded app experiences.
- [ ] AC-2: The container supports baseline states: loading, ready, active, complete, and error/fallback.
- [ ] AC-3: The container is designed to work with the shared design system and the Pencil approval workflow before code lands.

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

- Launching a real flagship app
- Bridge handshake security

## Done Definition

- The accepted behavior is implemented against the existing repo seams.
- Tests cover the primary happy path and the important failure mode for this story.
- Validation passes for the touched scope.
- Any new visible UI state has approved Pencil evidence before code if applicable.
