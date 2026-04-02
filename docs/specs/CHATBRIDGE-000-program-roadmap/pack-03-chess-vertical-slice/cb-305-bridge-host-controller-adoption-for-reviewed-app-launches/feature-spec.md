# CB-305 Feature Spec

## Metadata

- Story ID: CB-305
- Story Title: Bridge host controller adoption for reviewed app launches
- Author: Codex
- Date: 2026-04-02
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 03 - Chess Vertical Slice

## Problem Statement

The smoke audit showed that the bridge host controller is implemented and
tested, but live reviewed-app launches still bypass it. The current runtime
uses the controller for preview artifacts and harness flows instead of using it
as the real embedded-app launch seam.

## Story Pack Objectives

- Higher-level pack goal: keep the reviewed-app runtime on one host-owned
  embedded-app contract instead of mixing bridge-driven launches with seeded or
  synthetic shells.
- Pack primary objectives: O1, O2, O3
- How this story contributes to the pack: it reopens the Pack 03 runtime seam
  so later multi-app and authenticated-app work can launch through the same
  host-controlled bridge lifecycle.

## User Stories

- As the host, I want reviewed apps to launch through the bridge host
  controller so runtime state updates, lifecycle events, and recovery behavior
  are consistent.
- As a developer, I want one production launch seam for reviewed apps so tests,
  traces, and manual smoke runs are talking about the same runtime.

## Acceptance Criteria

- [ ] AC-1: Live reviewed-app launch surfaces use the bridge host controller
  instead of preview-only or seeded-only runtime shells.
- [ ] AC-2: Bridge-driven app lifecycle events update host-owned state for the
  launched reviewed app and keep preview-only artifact behavior separate.
- [ ] AC-3: The live launch path has regression coverage proving the bridge
  controller is the runtime seam for reviewed apps rather than an unused helper.

## Edge Cases

- Empty/null inputs: missing manifest or launch metadata must fail closed before
  bridge startup.
- Boundary values: repeated launches, reloads, and stale runtime handles must
  not leak bridge sessions.
- Invalid/malformed data: malformed app events must stay inside the normalized
  host recovery contract.
- External-service failures: bridge handshake failures must degrade into
  explicit host recovery states rather than silent seeded-card fallback.

## Non-Functional Requirements

- Security: preserve host ownership over bridge session startup, validation,
  and teardown.
- Performance: bridge startup should not noticeably regress launch latency for
  supported reviewed apps.
- Observability: bridge launch and failure paths must emit traceable host
  events.
- Reliability: preview artifacts must remain functional even while reviewed-app
  runtime surfaces migrate to bridge launch control.

## UI Requirements

- No new standalone visual design is required by default.
- If bridge adoption changes visible launch/loading/error states, reuse current
  ChatBridge shell patterns and only reopen Pencil if the change exceeds those
  patterns.

## Out of Scope

- Adding new reviewed apps to the default catalog
- Building new route/clarify/refuse UI
- Wiring Story Builder auth and resource actions

## Done Definition

- The live reviewed-app launch path runs through the bridge host controller.
- Preview-only artifact rendering remains explicitly separate and tested.
- Host lifecycle and recovery state stay normalized during bridge-driven
  launches.
- Validation passes for the touched scope.
