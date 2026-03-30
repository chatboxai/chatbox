# CB-504 Feature Spec

## Metadata

- Story ID: CB-504
- Story Title: Multi-app continuity in a single conversation
- Author: Codex
- Date: 2026-03-30
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 05 - Multi-App Routing and Debate Arena

## Problem Statement

Once more than one app exists, the host needs rules for active versus recent app context and how multiple app sessions coexist across a single conversation.

## Story Pack Objectives

- Higher-level pack goal: Move from one working flagship app to a governed multi-app platform that can choose among reviewed apps safely and explainably.
- Pack primary objectives: O1, O3
- How this story contributes to the pack: The host can manage multiple app instances within one conversation without misattributing context.

## User Stories

- As a user, I want to move between multiple app-backed activities in one thread without confusing the assistant.
- As the host, I want app summaries and active-session pointers to stay attributable and bounded.

## Acceptance Criteria

- [ ] AC-1: The host can manage multiple app instances within one conversation without misattributing context.
- [ ] AC-2: Active versus recent app precedence rules are explicit.
- [ ] AC-3: Later turns can reference the right app outcome when more than one app has been used.

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

- Partner auth token brokerage
- District kill-switch UI

## Done Definition

- The accepted behavior is implemented against the existing repo seams.
- Tests cover the primary happy path and the important failure mode for this story.
- Validation passes for the touched scope.
- Any new visible UI state has approved Pencil evidence before code if applicable.
