# CB-601 Feature Spec

## Metadata

- Story ID: CB-601
- Story Title: Platform auth versus app auth separation
- Author: Codex
- Date: 2026-03-30
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 06 - Authenticated Apps and Story Builder

## Problem Statement

Chatbox already has platform-side auth/token patterns, but ChatBridge introduces a second auth dimension: per-user grants for partner apps. The boundaries must be explicit.

## Story Pack Objectives

- Higher-level pack goal: Prove that ChatBridge can support authenticated partner apps without giving runtimes long-lived raw credentials, using Story Builder with Google Drive as the flagship flow.
- Pack primary objectives: O2, O4
- How this story contributes to the pack: Platform auth and app auth concepts are modeled separately.

## User Stories

- As the host, I want platform auth and app auth to remain separate so partner access does not distort the main user session model.
- As a security reviewer, I want clear ownership rules for platform tokens versus per-app grants.

## Acceptance Criteria

- [ ] AC-1: Platform auth and app auth concepts are modeled separately.
- [ ] AC-2: Per-app grants are linked to user and app identity without conflating them with Chatbox platform login.
- [ ] AC-3: The boundary is clear enough to drive later auth broker and proxy work.

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

- Actual Google Drive connect UI
- Partner SDK docs

## Done Definition

- The accepted behavior is implemented against the existing repo seams.
- Tests cover the primary happy path and the important failure mode for this story.
- Validation passes for the touched scope.
- Any new visible UI state has approved Pencil evidence before code if applicable.
