# CB-105 Feature Spec

## Metadata

- Story ID: CB-105
- Story Title: ChatBridge session console and accessibility hygiene
- Author: Codex
- Date: 2026-04-02
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 01 - Reliable Chat and History

## Problem Statement

The smoke audit surfaced renderer warnings during seeded ChatBridge sessions,
including an invalid DOM prop leak and a focused `aria-hidden` issue. Those are
not the biggest product blockers, but they pollute QA and can hide real
runtime failures.

## Story Pack Objectives

- Higher-level pack goal: keep core chat/session surfaces reliable enough that
  later ChatBridge runtime work does not sit on top of noisy or brittle shell
  behavior.
- Pack primary objectives: O1
- How this story contributes to the pack: it restores a cleaner and more
  accessible baseline for ChatBridge sessions and their surrounding shell.

## User Stories

- As a QA reviewer, I want seeded ChatBridge sessions to render without noisy
  React prop warnings so runtime defects stand out.
- As a keyboard or assistive-tech user, I want shell state transitions to avoid
  focused `aria-hidden` traps.

## Acceptance Criteria

- [ ] AC-1: Seeded ChatBridge sessions no longer emit the invalid `sessionType`
  DOM prop warning.
- [ ] AC-2: The shell/dev-tools transition path no longer emits the focused
  `aria-hidden` accessibility warning during normal smoke flows.
- [ ] AC-3: Regression coverage exists for the specific shell and component
  paths that caused the warnings.

## Edge Cases

- Empty/null inputs: warning cleanup must not break empty-session rendering.
- Boundary values: opening and closing drawers/modals during focus transitions
  must remain accessible.
- Invalid/malformed data: component prop filtering should stay robust when
  optional props are absent.
- External-service failures: out of scope.

## Non-Functional Requirements

- Security: no impact expected.
- Performance: avoid broad refactors for narrow warning cleanup.
- Observability: console output during smoke runs should be materially quieter.
- Reliability: warning cleanup must not change message/session semantics.

## UI Requirements

- No intentional visual redesign.
- Accessibility fixes may adjust hidden-state mechanics or focus management.

## Out of Scope

- Broader visual redesign of the chat shell
- General repo-wide warning cleanup outside the confirmed ChatBridge smoke path

## Done Definition

- Confirmed smoke warnings are removed or reduced to known unavoidable noise.
- Regression tests cover the fixed component/shell paths.
- Validation passes for the touched scope.
