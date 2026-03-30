# CB-104 Technical Plan

## Metadata

- Story ID: CB-104
- Story Title: App-aware persistence regression coverage
- Author: Codex
- Date: 2026-03-30

## Proposed Design

- Components/modules affected:
- `test/integration/`
- `src/__tests__/`
- `session helper utilities and formatters`
- Public interfaces/contracts:
- Regression test fixture shape for app-aware sessions
- Expected formatter/export behavior with embedded app artifacts
- Hydration invariants for stale or partial app lifecycle records
- Data flow summary:
  Synthetic app-aware sessions are loaded, rendered, exported, and resumed in tests to prove the substrate remains stable under future app lifecycle complexity.

## Architecture Decisions

- Decision:
  Treat regression coverage as part of pack 01 instead of postponing tests until app-specific work begins.
- Alternatives considered:
- Rely on existing session tests only
- Add tests after Chess lands
- Rationale:
  Once app lifecycle complexity spreads across the timeline, storage, and export code, late test coverage becomes much more expensive and less trustworthy.

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
- Integration fixture for app-aware session reload
- Export snapshot or assertion coverage
- Stale/partial lifecycle hydration behavior
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
