# CB-501 Technical Plan

## Metadata

- Story ID: CB-501
- Story Title: Reviewed app discovery and eligibility filtering
- Author: Codex
- Date: 2026-03-30

## Proposed Design

- Components/modules affected:
- `src/shared/chatbridge/registry.ts`
- `src/shared/chatbridge/policy.ts`
- `src/renderer/packages/chatbridge/router/`
- Public interfaces/contracts:
- Eligibility input contract
- Filtered app candidate output contract
- Debuggable reason codes for ineligible apps
- Data flow summary:
  Host loads reviewed app catalog -> evaluates tenant/teacher/classroom/context inputs -> returns eligible app candidates to the router.

## Architecture Decisions

- Decision:
  Resolve app eligibility before orchestration sees tool choices.
- Alternatives considered:
- Let the model see all reviewed apps and hope it self-filters
- Apply eligibility only after the model chooses an app
- Rationale:
  Routing discipline and safety both improve when the host restricts the candidate set before orchestration begins.

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
- Eligibility filtering by reviewed status and context
- Reason-code coverage for ineligible apps
- Router candidate list behavior
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
