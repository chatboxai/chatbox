# CB-702 Technical Plan

## Metadata

- Story ID: CB-702
- Story Title: Observability, health, kill switches, and rollback controls
- Author: Codex
- Date: 2026-03-30

## Proposed Design

- Components/modules affected:
- `src/shared/chatbridge/observability.ts`
- `src/main/chatbridge/`
- `src/shared/chatbridge/registry.ts`
- Public interfaces/contracts:
- Health and lifecycle telemetry schema
- Kill-switch and disablement contract
- Rollback behavior for active sessions
- Data flow summary:
  Host lifecycle emits observability events -> health/registry layer exposes state -> operators can disable an app or version -> new or active sessions respond according to policy.

## Architecture Decisions

- Decision:
  Treat app health and kill switches as part of the platform contract, not an afterthought.
- Alternatives considered:
- Rely on logs alone without explicit disablement controls
- Disable only the whole platform instead of specific app versions
- Rationale:
  Reviewed-partner safety requires fine-grained operational control once apps are in front of classrooms.

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
- Health event emission coverage
- Kill-switch behavior for new launches
- Disablement behavior for active sessions
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
