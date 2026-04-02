# CB-508 Technical Plan

## Metadata

- Story ID: CB-508
- Story Title: Active reviewed catalog transition and legacy retention
- Author: Codex
- Date: 2026-04-02

## Proposed Design

- Components/modules affected:
  - `docs/specs/CHATBRIDGE-000-program-roadmap/`
  - `chatbridge/PRESEARCH.md`
  - `chatbridge/ARCHITECTURE.md`
  - `src/shared/chatbridge/reviewed-app-catalog.ts`
  - `src/shared/chatbridge/live-seeds.ts`
  - `src/renderer/packages/initial_data.ts`
- Public interfaces/contracts:
  - active reviewed-app catalog membership
  - legacy app designation and exclusion from default runtime
  - roadmap and smoke-audit ownership of the active flagship set
- Data flow summary:
  product direction changes -> roadmap and architecture docs declare the new
  active flagship set -> default reviewed catalog and local seeds align to that
  set -> legacy apps remain checked in but are not on the active runtime path.

## Architecture Decisions

- Decision:
  preserve Debate Arena and Story Builder as legacy references while moving the
  active catalog to Chess, Drawing Kit, and Weather Dashboard.
- Alternatives considered:
  - delete the old app code and docs entirely
  - leave the active catalog unchanged and add new apps on top
- Rationale:
  keeping the old implementations is useful for reference, but the active
  roadmap and runtime should stop pulling the team toward apps that are no
  longer product priorities.

## Data Model / API Contracts

- Request shape:
  active reviewed-app membership should remain a checked-in, validated host
  contract rather than an ad hoc convention.
- Response shape:
  routing and seed data should expose only active flagship apps by default.
- Storage/index changes:
  legacy app status may need explicit markers in docs, seed data, or catalog
  metadata so active and legacy paths do not blur together.

## Dependency Plan

- Existing dependencies used:
  reviewed-app catalog, active seed data, roadmap progress, and presearch /
  architecture truth docs
- New dependencies proposed (if any):
  none by default
- Risk and mitigation:
  keep the transition explicit and update docs plus seed/runtime surfaces in the
  same story so the active catalog does not drift again

## Test Strategy

- Unit tests:
  - active reviewed catalog membership for the new flagship set
  - legacy apps excluded from default active catalog
- Integration tests:
  prove fresh runtime and seeds now expose the new active flagship set
- E2E or smoke tests:
  refresh smoke documentation so manual QA targets Drawing Kit and Weather
  instead of Debate Arena and Story Builder
- Edge-case coverage mapping:
  mixed active/legacy states and stale seed data should be covered explicitly

## UI Implementation Plan

- Behavior logic modules:
  keep active/legacy state in shared catalog, seeds, and docs rather than
  scattered component conditionals
- Component structure:
  no new dedicated components by default
- Accessibility implementation plan:
  not applicable unless active/legacy markers become visible
- Visual regression capture plan:
  not required by default

## Rollout and Risk Mitigation

- Rollback strategy:
  legacy apps remain intact, so the active catalog can be reverted without
  losing prior implementation reference points
- Feature flags/toggles:
  not required for the planning transition itself
- Observability checks:
  smoke docs and traces should clearly identify which app set is active

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
