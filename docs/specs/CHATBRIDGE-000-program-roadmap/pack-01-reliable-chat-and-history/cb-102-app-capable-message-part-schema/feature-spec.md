# CB-102 Feature Spec

## Metadata

- Story ID: CB-102
- Story Title: App-capable message part schema
- Author: Codex
- Date: 2026-03-30
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 01 - Reliable Chat and History

## Problem Statement

ChatBridge needs first-class timeline artifacts for app launch, active state, completion, and recoverable error. Today the message schema only knows text, image, info, reasoning, and tool-call parts.

## Story Pack Objectives

- Higher-level pack goal: Stabilize the current chat/session substrate so app-backed artifacts can live inside a thread without breaking persistence, export, or recovery semantics.
- Pack primary objectives: O1, O2
- How this story contributes to the pack: The shared message schema supports app-aware artifacts without breaking older sessions.

## User Stories

- As a user, I want app states to appear as native chat artifacts rather than opaque blobs.
- As the host, I want typed app artifacts so rendering, persistence, and memory logic can stay explicit.

## Acceptance Criteria

- [x] AC-1: The shared message schema supports app-aware artifacts without breaking older sessions.
- [x] AC-2: Message utilities and renderers have a clear extension point for app lifecycle parts.
- [x] AC-3: Tool-call parts remain available for tools, but app lifecycle state is not forced through the wrong abstraction.

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

- Actual partner app rendering
- Bridge security or app registry logic

## Done Definition

- The accepted behavior is implemented against the existing repo seams.
- Tests cover the primary happy path and the important failure mode for this story.
- Validation passes for the touched scope.
- Any new visible UI state has approved Pencil evidence before code if applicable.
