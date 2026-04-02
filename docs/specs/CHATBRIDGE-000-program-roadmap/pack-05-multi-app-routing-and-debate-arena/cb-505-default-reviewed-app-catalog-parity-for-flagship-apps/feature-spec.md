# CB-505 Feature Spec

## Metadata

- Story ID: CB-505
- Story Title: Default reviewed app catalog parity for flagship apps
- Author: Codex
- Date: 2026-04-02
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 05 - Multi-App Routing and Debate Arena

## Problem Statement

The smoke audit showed that the default reviewed-app catalog only contains
Chess. Debate Arena and Story Builder exist in tests and seeded fixtures, but a
fresh reviewed-partner runtime cannot consider them because they are absent
from the default production catalog.

## Story Pack Objectives

- Higher-level pack goal: ensure the reviewed multi-app platform exposes the
  scoped flagship apps to the live runtime instead of only to tests and seeded
  demos.
- Pack primary objectives: O1, O3
- How this story contributes to the pack: it restores catalog parity between
  documented flagship apps and the runtime inventory available to a new user.

## User Stories

- As a new user, I want the reviewed flagship apps to be discoverable by the
  live runtime rather than hidden behind seed data.
- As the host, I want the default reviewed catalog to reflect the approved
  flagship inventory so routing decisions start from the correct candidate set.

## Acceptance Criteria

- [ ] AC-1: The default reviewed-app catalog includes the approved flagship
  entries needed for the scoped runtime, not just Chess.
- [ ] AC-2: Catalog metadata for the default flagship apps is sufficient for
  eligibility filtering, routing, and live launch without relying on test-only
  fixtures.
- [ ] AC-3: Fresh-thread runtime behavior can refuse or defer for policy or
  launch reasons, but it must no longer fail simply because the flagship app is
  missing from the default catalog.

## Edge Cases

- Empty/null inputs: missing catalog configuration must fail closed and remain
  explainable.
- Boundary values: duplicate or stale reviewed app definitions must not cause
  unstable candidate ordering.
- Invalid/malformed data: malformed default catalog entries must fail
  validation before they become routing candidates.
- External-service failures: unavailable app runtimes must surface as launch or
  policy issues, not be masked as missing catalog membership.

## Non-Functional Requirements

- Security: keep catalog membership explicit and reviewed rather than inferred
  from arbitrary app registrations.
- Performance: catalog expansion must not add noticeable overhead to prompt
  routing.
- Observability: runtime logs and traces should distinguish catalog presence
  from later routing or launch failures.
- Reliability: the default catalog should stay deterministic across fresh app
  sessions and seeded-session refreshes.

## UI Requirements

- No dedicated visual design is required.
- Any visible app-discovery text should stay inside existing host-owned routing
  or app-shell surfaces.

## Out of Scope

- Building the live invoke/clarify/refuse UI
- Story Builder auth/resource proxy execution
- Bridge host controller adoption

## Done Definition

- The default reviewed catalog exposes the approved flagship apps needed by the
  scoped runtime.
- Routing no longer fails simply because non-Chess flagship apps are absent
  from default runtime configuration.
- Regression tests cover default-catalog presence and missing-entry failures.
- Validation passes for the touched scope.
