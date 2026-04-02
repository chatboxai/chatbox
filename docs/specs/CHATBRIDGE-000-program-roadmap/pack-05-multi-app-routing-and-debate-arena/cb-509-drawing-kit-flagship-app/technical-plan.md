# CB-509 Technical Plan

## Metadata

- Story ID: CB-509
- Story Title: Drawing Kit flagship app
- Author: Codex
- Date: 2026-04-02

## Proposed Design

- Components/modules affected:
  - `src/shared/chatbridge/`
  - `src/renderer/components/chatbridge/apps/`
  - `src/renderer/packages/chatbridge/`
  - `design/stories/`
  - `test/integration/chatbridge/scenarios/`
- Public interfaces/contracts:
  - Drawing Kit reviewed manifest and launch contract
  - host-visible drawing snapshot or checkpoint contract
  - completion summary and later-turn reasoning-context contract
- Data flow summary:
  prompt routes to Drawing Kit -> host launches inline canvas app -> drawing
  state reduces to bounded host checkpoints -> completion or pause persists
  summary -> later turns can reference the drawing session.

## Architecture Decisions

- Decision:
  build Drawing Kit as a no-auth reviewed app with bounded host snapshots
  instead of raw event replay as the model-facing state contract.
- Alternatives considered:
  - keep Debate Arena as the only second flagship app
  - make Drawing Kit purely local UI state with no host-aware continuity
- Rationale:
  the app should prove interactive visual UI inside chat without weakening the
  host-owned state model.

## Data Model / API Contracts

- Request shape:
  drawing actions should normalize into bounded host checkpoint records rather
  than unbounded raw stroke streams for later-turn model use.
- Response shape:
  completion and resume should use a host-owned drawing summary plus runtime
  metadata.
- Storage/index changes:
  may require a drawing-session state contract under `src/shared/chatbridge/`
  plus persisted checkpoints.

## Dependency Plan

- Existing dependencies used:
  reviewed-app catalog, live invocation path, bridge/runtime surfaces, Pack 04
  summary normalization, and active context injection
- New dependencies proposed (if any):
  a bounded drawing-state contract and renderer app surface
- Risk and mitigation:
  keep model-facing state compact and separate from high-frequency canvas UI
  events

## Test Strategy

- Unit tests:
  - drawing snapshot normalization
  - completion summary derivation
- Integration tests:
  prove Drawing Kit can launch, update state, resume, and complete in the live
  reviewed-app runtime
- E2E or smoke tests:
  add a seeded or live smoke path for canvas launch, sketch interaction, and
  follow-up chat
- Edge-case coverage mapping:
  blank canvases, large drawing sessions, malformed events, and resume behavior
  should be covered explicitly

## UI Implementation Plan

- Behavior logic modules:
  keep drawing-state normalization and lifecycle control outside presentational
  canvas components
- Component structure:
  use an inline chat app shell with a canvas surface, compact tool rail, and
  clear completion/recovery states
- Accessibility implementation plan:
  tool controls need keyboard access and non-pointer affordances; status and
  recovery messages must be screen-reader readable
- Visual regression capture plan:
  capture blank, active drawing, completed, resumed, and degraded states after
  Pencil approval

## Rollout and Risk Mitigation

- Rollback strategy:
  keep Drawing Kit isolated behind the reviewed-app catalog and host runtime
  seams
- Feature flags/toggles:
  acceptable if the new flagship app needs staged manual smoke rollout
- Observability checks:
  emit traces for launch, checkpoint updates, completion, resume, and degraded
  states

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
