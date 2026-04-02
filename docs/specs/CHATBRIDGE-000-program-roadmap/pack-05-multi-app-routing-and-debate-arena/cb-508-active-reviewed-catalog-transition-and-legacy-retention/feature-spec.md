# CB-508 Feature Spec

## Metadata

- Story ID: CB-508
- Story Title: Active reviewed catalog transition and legacy retention
- Author: Codex
- Date: 2026-04-02
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 05 - Multi-App Routing and Debate Arena

## Problem Statement

The current ChatBridge planning set assumes the active flagship catalog is
Chess, Debate Arena, and Story Builder. Product direction has now changed. The
active flagship catalog should become Chess, Drawing Kit, and Weather
Dashboard, while Debate Arena and Story Builder remain in the repo as legacy
reference implementations rather than active reviewed apps in the default
runtime.

## Story Pack Objectives

- Higher-level pack goal: keep the active reviewed-app catalog aligned with the
  current product direction without losing the legacy reference value of prior
  flagship work.
- Pack primary objectives: O1, O3
- How this story contributes to the pack: it changes the active reviewed-app
  inventory and planning truth so later runtime work targets the new flagship
  set instead of trying to restore apps that are no longer active.

## User Stories

- As a product owner, I want the active reviewed-app catalog to reflect the
  current flagship set so the roadmap and runtime stop targeting the wrong
  apps.
- As a developer, I want Debate Arena and Story Builder preserved as legacy
  references so prior work stays inspectable without remaining on the active
  path.

## Acceptance Criteria

- [ ] AC-1: The active reviewed-app planning and catalog transition to Chess,
  Drawing Kit, and Weather Dashboard as the flagship set.
- [ ] AC-2: Debate Arena and Story Builder are explicitly marked legacy and are
  removed from the active default runtime/catalog path without deleting their
  checked-in code and historical docs.
- [ ] AC-3: The rebuild queue, pack statuses, and smoke-audit control docs all
  reflect the new active flagship set and no longer treat legacy app restoration
  as the default path.

## Edge Cases

- Empty/null inputs: if an active app definition is missing during the
  transition, the host should fail closed rather than silently retaining a
  legacy app in active runtime.
- Boundary values: seeds, presets, and docs must distinguish active from legacy
  apps consistently during the transition period.
- Invalid/malformed data: malformed legacy markers or catalog records must fail
  validation rather than producing mixed active/legacy state.
- External-service failures: Weather Dashboard API choices should not force a
  Story Builder auth path back into the active queue by accident.

## Non-Functional Requirements

- Security: preserve the reviewed-partner model and do not broaden app
  activation implicitly during the transition.
- Performance: catalog transition should not add unnecessary runtime branching.
- Observability: traces and smoke docs should clearly identify active versus
  legacy app paths.
- Reliability: documentation, seeds, and runtime catalog state should agree on
  the active flagship set.

## UI Requirements

- No dedicated visible UI is required by default.
- If active/legacy labeling becomes user-visible, keep it inside existing
  developer or routing surfaces.

## Out of Scope

- Implementing the Drawing Kit runtime itself
- Implementing the Weather Dashboard runtime itself
- Deleting legacy Debate Arena or Story Builder code from the repo

## Done Definition

- Active catalog and roadmap truth name Chess, Drawing Kit, and Weather
  Dashboard as the flagship apps.
- Debate Arena and Story Builder remain available only as legacy references.
- The active rebuild queue targets the new flagship set.
- Validation passes for the touched scope.
