# CB-605 Feature Spec

## Metadata

- Story ID: CB-605
- Story Title: Story Builder runtime auth and resource proxy integration
- Author: Codex
- Date: 2026-04-02
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 06 - Authenticated Apps and Story Builder

## Problem Statement

The smoke audit showed that the auth broker and resource proxy are implemented
and well-tested, but the live Story Builder runtime does not actually invoke
them. Story Builder mostly behaves like a seeded shell rather than a live,
host-mediated authenticated app.

## Story Pack Objectives

- Higher-level pack goal: make Story Builder honest as the flagship
  authenticated reviewed app in the live runtime.
- Pack primary objectives: O2, O4
- How this story contributes to the pack: it wires the validated Pack 06 auth,
  credential-handle, and resource-proxy seams into the actual Story Builder
  launch and follow-up flow.

## User Stories

- As a user, I want Story Builder to request connection, read or save through
  host-owned auth and resource controls, and resume my work in the live
  runtime.
- As the host, I want Story Builder runtime actions to go through the same
  validated auth broker and resource proxy instead of bypassing them through
  seeded state.

## Acceptance Criteria

- [ ] AC-1: Live Story Builder launch and follow-up actions invoke the
  host-owned auth broker when connection or credential handles are required.
- [ ] AC-2: Story Builder resource actions in live runtime flow through the
  host-mediated resource proxy rather than direct or test-only paths.
- [ ] AC-3: Save, resume, auth-expiry, and degraded-auth cases are visible and
  recoverable in the live Story Builder runtime.

## Edge Cases

- Empty/null inputs: missing auth handles or document identifiers must fail
  explicitly before resource actions run.
- Boundary values: expired handles, repeated save requests, and reload/resume
  flows must preserve host-owned continuity.
- Invalid/malformed data: malformed resource requests or auth callbacks must
  fail closed and stay auditable.
- External-service failures: denied auth, proxy failures, or Drive read/write
  errors must degrade through the host recovery model without exposing raw
  credentials.

## Non-Functional Requirements

- Security: raw credentials must remain outside the app runtime and traces must
  preserve existing redaction rules.
- Performance: auth and resource mediation must not freeze the Story Builder
  editing surface during normal usage.
- Observability: live Story Builder auth/resource flows must emit traceable
  events distinct from seeded-only behavior.
- Reliability: save and resume continuity must survive reloads and expired-auth
  recovery.

## UI Requirements

- Reuse the approved Story Builder shell and connection/status patterns where
  possible.
- If runtime auth/resource states require materially new visible UI beyond the
  approved Story Builder direction, reopen Pencil before final UI code.

## Out of Scope

- Building new non-Story Builder authenticated apps
- Catalog parity or route-artifact UI
- General bridge runtime adoption outside Story Builder

## Done Definition

- Story Builder live runtime uses the host-owned auth broker and resource
  proxy.
- Save, resume, and auth-expiry flows are exercised in live runtime proof, not
  only seeded fixtures.
- Traces exist for the live authenticated app path.
- Validation passes for the touched scope.
