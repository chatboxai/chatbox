# CB-401 Feature Spec

## Metadata

- Story ID: CB-401
- Story Title: Structured completion payload contract
- Author: Codex
- Date: 2026-03-30
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 04 - Completion and App Memory

## Problem Statement

Completion events need a reviewed payload shape that covers outcome, resumability, suggested summaries, and error context without forcing the host to parse arbitrary app prose.

## Story Pack Objectives

- Higher-level pack goal: Turn app completion and model-visible memory into first-class host behavior so later app breadth does not rest on vague or app-authored summaries.
- Pack primary objectives: O1, O2, O3
- How this story contributes to the pack: A typed completion payload schema exists for success, interruption, and failure cases.

## User Stories

- As the host, I want completion payloads to be structured so I can validate and persist them safely.
- As an app developer, I want a clear completion contract that tells me what the host expects when an app ends or pauses.

## Acceptance Criteria

- [ ] AC-1: A typed completion payload schema exists for success, interruption, and failure cases.
- [ ] AC-2: The payload supports structured outcome data and optional suggested summaries without bypassing host control.
- [ ] AC-3: Completion contracts are reusable across Chess, Debate Arena, and Story Builder.

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

- UI polish for completion cards
- Tenant-level policy enforcement

## Done Definition

- The accepted behavior is implemented against the existing repo seams.
- Tests cover the primary happy path and the important failure mode for this story.
- Validation passes for the touched scope.
- Any new visible UI state has approved Pencil evidence before code if applicable.
