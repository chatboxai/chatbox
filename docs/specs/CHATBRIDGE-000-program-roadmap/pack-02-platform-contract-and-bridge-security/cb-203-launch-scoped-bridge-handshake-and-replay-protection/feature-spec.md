# CB-203 Feature Spec

## Metadata

- Story ID: CB-203
- Story Title: Launch-scoped bridge handshake and replay protection
- Author: Codex
- Date: 2026-03-30
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 02 - Platform Contract and Bridge Security

## Problem Statement

A partner bridge based on plain postMessage and origin checks is too weak for a reviewed K-12 partner platform. The host needs a launch-scoped handshake, expected origin, dedicated channel, and replay protection semantics.

## Story Pack Objectives

- Higher-level pack goal: Define what an approved app is, how it launches, how it talks to the host, and how the host validates execution and lifecycle events safely.
- Pack primary objectives: O2, O3
- How this story contributes to the pack: A bridgeSession contract exists with appInstanceId, expected origin, expiry, and capabilities.

## User Stories

- As the host, I want every app launch bound to a specific bridge session so unrelated frames cannot spoof lifecycle events.
- As a security reviewer, I want replayed or duplicated events rejected predictably at the host boundary.

## Acceptance Criteria

- [ ] AC-1: A bridgeSession contract exists with appInstanceId, expected origin, expiry, and capabilities.
- [ ] AC-2: The host bootstraps partner runtimes through a dedicated session handshake rather than ambient messaging.
- [ ] AC-3: Sequence numbers and idempotency rules are explicit for state-changing bridge events.

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

- Tenant policy resolution
- Flagship app behavior

## Done Definition

- The accepted behavior is implemented against the existing repo seams.
- Tests cover the primary happy path and the important failure mode for this story.
- Validation passes for the touched scope.
- Any new visible UI state has approved Pencil evidence before code if applicable.
