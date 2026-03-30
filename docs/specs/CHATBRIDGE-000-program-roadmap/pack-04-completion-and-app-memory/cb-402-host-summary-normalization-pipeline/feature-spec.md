# CB-402 Feature Spec

## Metadata

- Story ID: CB-402
- Story Title: Host summary normalization pipeline
- Author: Codex
- Date: 2026-03-30
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 04 - Completion and App Memory

## Problem Statement

Apps should not write directly into model-visible memory. The host needs a normalization step that validates, redacts, and converts completion data into summaryForModel.

## Story Pack Objectives

- Higher-level pack goal: Turn app completion and model-visible memory into first-class host behavior so later app breadth does not rest on vague or app-authored summaries.
- Pack primary objectives: O1, O2, O3
- How this story contributes to the pack: A host-owned normalization pipeline exists between completion payloads and model-visible memory.

## User Stories

- As the host, I want full control over what app outcomes become model-visible memory.
- As a policy owner, I want redaction and validation to happen before partner-authored content reaches later turns.

## Acceptance Criteria

- [ ] AC-1: A host-owned normalization pipeline exists between completion payloads and model-visible memory.
- [ ] AC-2: Redaction and validation rules can reject or trim unsafe/unnecessary detail.
- [ ] AC-3: summaryForModel is derived from host-approved data, not raw partner output.

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

- Partner SDK packaging
- Per-tenant policy UI

## Done Definition

- The accepted behavior is implemented against the existing repo seams.
- Tests cover the primary happy path and the important failure mode for this story.
- Validation passes for the touched scope.
- Any new visible UI state has approved Pencil evidence before code if applicable.
