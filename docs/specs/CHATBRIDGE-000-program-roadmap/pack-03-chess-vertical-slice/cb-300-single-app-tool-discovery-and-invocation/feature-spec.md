# CB-300 Feature Spec

## Metadata

- Story ID: CB-300
- Story Title: Single-app tool discovery and invocation
- Author: Codex
- Date: 2026-03-30
- Related PRD/phase gate: Pack 03 - Chess Vertical Slice

## Problem Statement

Before richer app UI work expands, the chatbot must be able to discover and
invoke a single approved app's tools cleanly. This is the first end-to-end proof
that the platform contract actually connects to the orchestrator.

## Story Pack Objectives

- Higher-level pack goal: prove the first clean single-app vertical slice
- Pack primary objectives: O1, O2
- How this story contributes to the pack:
  it satisfies the required single-app invocation step before UI embedding goes
  deeper

## User Stories

- As a user, I want the assistant to recognize a Chess request and invoke the
  right app capability.
- As the host, I want one clean reviewed-app tool path before I expand richer
  in-thread UI and lifecycle work.

## Acceptance Criteria

- [x] AC-1: The chatbot can discover the approved Chess app capability from a
      natural-language request.
- [x] AC-2: The host invokes the app tool through the reviewed contract rather
      than an ad hoc side channel.
- [x] AC-3: The invocation path is observable and testable before UI embedding
      expands further.

## Edge Cases

- Empty/null inputs: unrelated prompts stay chat-only
- Boundary values: ambiguous prompts should not jump to the wrong app
- Invalid/malformed data: invalid tool args fail closed
- External-service failures: invocation failures produce a host-visible recoverable
  state

## Non-Functional Requirements

- Security: reviewed tool contract and host validation remain mandatory
- Performance: invocation should not block the main chat experience unnecessarily
- Observability: invocation events should be traceable
- Reliability: failed invocations should not poison the session

## UI Requirements

- No net-new visual design scope is required beyond existing host artifacts for
  invocation visibility.

## Out of Scope

- Full Chess UI rendering polish
- End-of-game completion summaries

## Done Definition

- One approved app tool can be discovered and invoked end to end.
- The path is observable and regression-tested.
