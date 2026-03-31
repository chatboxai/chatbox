# CB-201 Feature Spec

## Metadata

- Story ID: CB-201
- Story Title: Reviewed app manifest and registry contract
- Author: Codex
- Date: 2026-03-30
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 02 - Platform Contract and Bridge Security

## Problem Statement

ChatBridge cannot safely expose app tools or UI until there is a reviewed manifest contract that describes capabilities, auth mode, permissions, versioning, and availability.

## Story Pack Objectives

- Higher-level pack goal: Define what an approved app is, how it launches, how it talks to the host, and how the host validates execution and lifecycle events safely.
- Pack primary objectives: O2, O3
- How this story contributes to the pack: A typed manifest contract exists for reviewed app registration.

## User Stories

- As the host, I want each app to be described by a validated manifest so routing and policy decisions are explicit.
- As a reviewed partner, I want a clear manifest contract so I know how to register capabilities correctly.

## Acceptance Criteria

- [x] AC-1: A typed manifest contract exists for reviewed app registration.
- [x] AC-2: The contract covers identity, origin, auth mode, permissions, tool schemas, supported events, and completion modes.
- [x] AC-3: Registry ingestion rules fail closed for invalid or unsupported manifests.

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

- Tenant policy precedence
- Running a real flagship app

## Done Definition

- The accepted behavior is implemented against the existing repo seams.
- Tests cover the primary happy path and the important failure mode for this story.
- Validation passes for the touched scope.
- Any new visible UI state has approved Pencil evidence before code if applicable.
