# CB-507 Feature Spec

## Metadata

- Story ID: CB-507
- Story Title: Live route clarify refuse artifacts and actions
- Author: Codex
- Date: 2026-04-02
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 05 - Multi-App Routing and Debate Arena

## Problem Statement

The smoke audit found that route decisions and their artifact contracts are
mostly exercised in tests. In the live product, ambiguous prompts and chat-only
prompts do not surface a dedicated ChatBridge decision artifact with actionable
clarify or refusal behavior.

## Story Pack Objectives

- Higher-level pack goal: make reviewed-app routing visible and explainable in
  the real chat experience.
- Pack primary objectives: O1, O2, O3
- How this story contributes to the pack: it turns test-only route artifacts
  into live, host-owned chat artifacts that can clarify, refuse, or proceed
  with explicit next-step actions.

## User Stories

- As a user, I want ambiguous app-routing prompts to show clear next-step
  choices instead of silently guessing or failing opaquely.
- As the host, I want chat-only or refused app cases to stay explicit in the
  timeline so the system explains why no app launched.

## Acceptance Criteria

- [ ] AC-1: Live ambiguous prompts render a dedicated ChatBridge clarify
  artifact with actionable choices in the chat timeline.
- [ ] AC-2: Live chat-only or ineligible prompts render a dedicated refusal
  artifact with explicit reasoning and no unintended app launch.
- [ ] AC-3: User actions on the clarify artifact feed back into host-owned
  route and launch state rather than bypassing the reviewed routing contract.

## Edge Cases

- Empty/null inputs: malformed or absent route decisions must fail closed to a
  host-owned refusal artifact.
- Boundary values: repeated artifact actions and stale decisions must not
  launch the wrong app.
- Invalid/malformed data: unknown reason codes or unsupported actions must
  degrade explicitly.
- External-service failures: launch or policy failures after a clarify choice
  should remain visible in the same host-owned route/recovery model.

## Non-Functional Requirements

- Security: preserve host authority over route decisions and action handling.
- Performance: route artifact rendering must stay lightweight and not block chat
  responsiveness.
- Observability: traces and logs should distinguish invoke, clarify, refusal,
  and post-clarify launch behavior.
- Reliability: artifacts must remain stable across reloads and persisted chat
  history.

## UI Requirements

- This story changes visible chat UI.
- It requires Pencil review before implementation if the current routed-artifact
  shell is not already approved for these states.
- The artifact must live inline in the existing chat timeline and preserve
  keyboard and screen-reader accessibility.

## Out of Scope

- Catalog parity
- Bridge host-controller adoption
- Story Builder auth/resource execution

## Done Definition

- Clarify and refusal artifacts render in the live runtime, not just in tests.
- Artifact actions route through host-owned state and launch seams.
- Persistence, accessibility, and degraded cases are covered.
- Validation passes for the touched scope.
