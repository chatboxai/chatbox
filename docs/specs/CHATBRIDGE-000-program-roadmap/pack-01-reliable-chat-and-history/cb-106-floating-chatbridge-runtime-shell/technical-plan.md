# CB-106 Technical Plan

## Metadata

- Story ID: CB-106
- Story Title: Floating ChatBridge runtime shell
- Author: Codex
- Date: 2026-04-02

## Proposed Design

- Components/modules affected:
  - `src/renderer/routes/session/`
  - `src/renderer/components/chatbridge/`
  - `src/renderer/components/chatbridge/apps/`
  - `src/renderer/stores/`
  - `design/stories/`
  - `test/integration/chatbridge/scenarios/`
- Public interfaces/contracts:
  - session-level UI contract for which ChatBridge app instance is currently
    floated
  - compact message-anchor presentation contract for app parts that are being
    surfaced in the floating shell
  - responsive shell presentation rules for desktop versus small-screen/mobile
- Data flow summary:
  app part enters launching/ready/active state -> host selects the app instance
  that should be floated -> session route renders the live runtime in a
  floating shell near the composer -> original message keeps a compact anchor ->
  minimize/restore actions update session UI state without mutating the durable
  message record.

## Architecture Decisions

- Decision:
  introduce a session-level floating runtime host rather than keeping the live
  viewport mounted only inside the message cell.
- Alternatives considered:
  - keep the inline-only shell and rely on “jump to app” scrolling
  - open the app in a modal or separate window detached from the session
  - duplicate the runtime both inline and floated
- Rationale:
  the session needs one visible control surface for active app interaction while
  preserving the message artifact as durable history.

## Data Model / API Contracts

- Request shape:
  no new model-facing request contract is required; this is a renderer/session
  shell change.
- Response shape:
  app parts may gain a compact “floated” anchor presentation path in renderer
  view logic, but the stored message part contract should remain stable.
- Storage/index changes:
  add session-scoped UI state for floated app instance selection and
  minimize/restore state, preferably outside the durable message/session data.

## Dependency Plan

- Existing dependencies used:
  existing ChatBridge shell components, session route, UI store, overlay/focus
  utilities, responsive screen hooks, and app-record selection helpers.
- New dependencies proposed (if any):
  none preferred; reuse existing overlay/dialog primitives already in the repo.
- Risk and mitigation:
  keep the shell state in UI/session state rather than altering the persisted
  message schema unless implementation proves that impossible.

## Test Strategy

- Unit tests:
  - selector logic that chooses which app instance should float
  - compact anchor versus floated-host rendering rules
- Integration tests:
  - active Chess runtime remains visible while later user messages continue
  - minimize and restore behavior
  - stale/degraded app state falls back cleanly to the message anchor
- E2E or smoke tests:
  - seeded ChatBridge runtime session should show the floating host without
    forcing the user to scroll back up
- Edge-case coverage mapping:
  multiple active app parts, reload continuity, small-screen behavior, and focus
  handoff must be covered explicitly

## UI Implementation Plan

- Behavior logic modules:
  derive floated app selection from session message/app state in a dedicated
  selector or store helper, not ad hoc inside message components
- Component structure:
  add a session-level `ChatBridgeRuntimeDock` or equivalent above the input area
  and refactor message-level app rendering into a compact anchor mode when the
  app is actively floated
- Accessibility implementation plan:
  reuse overlay focus handoff patterns already in the repo; restore/minimize and
  “jump back to source message” controls must be keyboard reachable and clearly
  labeled
- Visual regression capture plan:
  capture desktop docked, mobile bottom-sheet, minimized, restored, and
  degraded/fallback states after Pencil approval

## Rollout and Risk Mitigation

- Rollback strategy:
  keep the old inline path reachable behind a narrow renderer seam while the new
  dock host stabilizes
- Feature flags/toggles:
  optional if implementation needs a guarded rollout, but prefer a direct
  replacement if the change stays isolated to ChatBridge surfaces
- Observability checks:
  trace or log shell promotion, restore, minimize, and recovery decisions if the
  implementation touches existing LangSmith/UI observability seams

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
