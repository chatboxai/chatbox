# CB-102 Technical Plan

## Metadata

- Story ID: CB-102
- Story Title: App-capable message part schema
- Author: Codex
- Date: 2026-03-30

## Proposed Design

- Components/modules affected:
- `src/shared/types/session.ts`
- `src/shared/utils/message.ts`
- `src/renderer/components/chat/Message.tsx`
- Public interfaces/contracts:
- App launch, active, completion, and error message-part types
- Backward-compatible message discriminated union rules
- Renderer fallback rules for unknown app-aware message parts
- Data flow summary:
  Assistant/tool routing emits app-aware artifacts -> shared session schema validates them -> timeline rendering branches to the right host-owned UI surface.

## Architecture Decisions

- Decision:
  Introduce explicit app-aware message parts instead of overloading tool-call parts.
- Alternatives considered:
- Represent apps as generic info parts
- Tunnel app state through existing tool-call results
- Rationale:
  The host needs a stable schema boundary for app lifecycle concepts before any app-specific UI or memory behavior can be dependable.

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
- Schema parse/serialize for new app-aware message parts
- Unknown/legacy message compatibility behavior
- Renderer handling of app-aware parts without throwing
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
  use approved Chatbox layout and design-system patterns
- Accessibility implementation plan:
  define keyboard behavior, roles, labels, and readable status/error states for any surfaced UI
- Visual regression capture plan:
  capture the key visible states for this story if the implementation introduces a new visible surface

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
