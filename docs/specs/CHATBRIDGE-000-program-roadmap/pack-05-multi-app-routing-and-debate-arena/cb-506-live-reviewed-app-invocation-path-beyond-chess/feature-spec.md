# CB-506 Feature Spec

## Metadata

- Story ID: CB-506
- Story Title: Live reviewed app invocation path beyond Chess
- Author: Codex
- Date: 2026-04-02
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 05 - Multi-App Routing and Debate Arena

## Problem Statement

The live chat generation path still uses a Chess-only shortcut. Even with
reviewed routing helpers in the codebase, `stream-text.ts` mounts a single-app
tool set that only turns Chess into an executable app launch.

## Story Pack Objectives

- Higher-level pack goal: make the live chat runtime actually invoke the
  reviewed flagship apps that the multi-app platform claims to support.
- Pack primary objectives: O1, O2, O3
- How this story contributes to the pack: it replaces the Chess-only execution
  shortcut with a host-owned invocation path that can launch reviewed apps from
  the live prompt flow.

## User Stories

- As a user, I want the live chat runtime to launch the right reviewed app
  beyond Chess when my prompt matches that app.
- As the host, I want prompt-driven app invocation to consume the reviewed-app
  route decision instead of bypassing multi-app orchestration.

## Acceptance Criteria

- [ ] AC-1: The live generation path no longer relies on a Chess-only reviewed
  tool shortcut as the sole executable app path.
- [ ] AC-2: A reviewed app that is present in the default catalog and eligible
  for the prompt can be invoked through the live chat path without seed-only
  setup.
- [ ] AC-3: Invocation failures remain explicit and traceable, and do not fall
  back to silent chat-only behavior when the host intended to launch an app.

## Edge Cases

- Empty/null inputs: missing route inputs or catalog state must degrade into an
  explicit host decision.
- Boundary values: repeated prompt attempts and active-session continuity must
  not reintroduce the Chess-only shortcut.
- Invalid/malformed data: malformed route decisions must fail closed before any
  launch attempt starts.
- External-service failures: launch failures must remain explicit even when the
  app catalog and routing decision are valid.

## Non-Functional Requirements

- Security: preserve host authority over app invocation and never let model
  output directly bypass route validation.
- Performance: routing and invocation plumbing should not materially regress
  chat responsiveness.
- Observability: the new invocation path must emit traces and logs distinct
  from chat-only or refusal outcomes.
- Reliability: the live invocation path must stay deterministic across fresh
  threads and seeded-session rebuilds.

## UI Requirements

- No new standalone visual design is required by default.
- The launch path should continue to surface state through existing ChatBridge
  shell patterns; route-specific artifact UI is handled by CB-507.

## Out of Scope

- Clarify/refuse renderer UI
- Story Builder auth and resource proxy execution
- Catalog parity itself

## Done Definition

- The live prompt-driven app launch path is no longer Chess-only.
- At least one non-Chess reviewed flagship app launches from a fresh runtime
  path without seed-only setup.
- Invocation failures are explicit and traceable.
- Validation passes for the touched scope.
