# CB-103 Technical Plan

## Metadata

- Story ID: CB-103
- Story Title: Host-owned app container shell
- Author: Codex
- Date: 2026-03-30

## Proposed Design

- Components/modules affected:
- `src/renderer/components/Artifact.tsx`
- `src/renderer/components/chat/Message.tsx`
- `src/renderer/components/chatbridge/`
- `design/system/design-system.lib.pen`
- Public interfaces/contracts:
- App container props and state model
- Timeline rendering contract for app-aware message parts
- Fallback and empty-state behavior for degraded app sessions
- Data flow summary:
  Timeline receives an app-aware message part -> host-owned container chooses the right state UI -> later packs mount a native app or iframe runtime inside the container.

## Architecture Decisions

- Decision:
  Create a dedicated ChatBridge container instead of stretching Artifact into a generalized partner runtime host.
- Alternatives considered:
- Continue using Artifact as the embedded app surface
- Wait until Chess to define the container abstraction
- Rationale:
  The host runtime needs a stable UI seam before app-specific code can arrive without baking Chess-first assumptions into the timeline.

## Data Model / API Contracts

- Request shape:
  Inputs should follow the contracts above and be validated before any host-side state transition.
- Response shape:
  Outputs should be normalized into host-owned records or timeline artifacts rather than ad hoc partner payloads.
- Storage/index changes:
  This story should update only the specific host/session/runtime records it needs and keep the broader ChatBridge model forward-compatible.

## Dependency Plan

- Existing dependencies used:
  current Chatbox session schema, renderer/timeline patterns, and model/tool orchestration seams
- New dependencies proposed (if any):
  none by default; prefer existing stack and utilities unless implementation proves a real gap
- Risk and mitigation:
  keep the work inside existing seams and add targeted tests before broad refactors

## Test Strategy

- Unit tests:
- Renderer state coverage for loading/ready/error/complete
- Accessibility coverage for focus, labels, and keyboard affordances
- Smoke test that app-aware timeline parts render without crashing the thread
- Integration tests:
  cover the full host/runtime path touched by this story rather than only isolated helpers
- E2E or smoke tests:
  add a focused smoke path if the story changes user-visible app flow or session continuity
- Edge-case coverage mapping:
  stale state, malformed inputs, and degraded fallback behavior should be covered explicitly

## UI Implementation Plan

- Behavior logic modules:
  host/runtime/state rules should live outside presentational UI components
- Component structure:
  use approved Chatbox layout and design-system patterns and the approved Pencil variation
- Accessibility implementation plan:
  define keyboard behavior, roles, labels, and readable status/error states for any surfaced UI
- Visual regression capture plan:
  capture the key visible states for this story after Pencil approval and before implementation completion

## Rollout and Risk Mitigation

- Rollback strategy:
  keep the change behind the story boundary and prefer reversible schema/runtime updates where practical
- Feature flags/toggles:
  use a targeted toggle if the change affects active user flows or partner-runtime exposure
- Observability checks:
  ensure the new path emits enough structured state to debug launch, failure, and recovery behavior

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
