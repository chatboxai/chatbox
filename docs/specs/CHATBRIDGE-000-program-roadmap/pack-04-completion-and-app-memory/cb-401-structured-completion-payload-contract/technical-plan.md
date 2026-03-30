# CB-401 Technical Plan

## Metadata

- Story ID: CB-401
- Story Title: Structured completion payload contract
- Author: Codex
- Date: 2026-03-30

## Proposed Design

- Components/modules affected:
- `src/shared/chatbridge/completion.ts`
- `src/shared/chatbridge/events.ts`
- `test/integration/chatbridge/`
- Public interfaces/contracts:
- Completion payload schema
- Outcome and resumability fields
- Optional suggested summary contract
- Data flow summary:
  App emits app.complete or related lifecycle signal -> host validates payload -> host persists normalized outcome and forwards it into later summary stages.

## Architecture Decisions

- Decision:
  Require structured completion payloads instead of app-authored freeform completion messages.
- Alternatives considered:
- Use arbitrary summary text only
- Infer completion from app state snapshots
- Rationale:
  Reliable post-app conversation continuity depends on the host receiving predictable, machine-validatable completion data.

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
- Completion payload parse and validation tests
- Missing/invalid completion rejection behavior
- Compatibility coverage across app types
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
