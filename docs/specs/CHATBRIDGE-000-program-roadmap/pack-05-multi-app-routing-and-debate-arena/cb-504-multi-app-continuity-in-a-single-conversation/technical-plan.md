# CB-504 Technical Plan

## Metadata

- Story ID: CB-504
- Story Title: Multi-app continuity in a single conversation
- Author: Codex
- Date: 2026-03-30

## Proposed Design

- Components/modules affected:
- `src/renderer/packages/chatbridge/`
- `src/renderer/packages/context-management/`
- `src/shared/chatbridge/instance.ts`
- Public interfaces/contracts:
- Active versus recent app precedence rules
- Conversation-scoped app instance selection contract
- Attribution rules for later follow-up turns
- Data flow summary:
  Multiple app instances accumulate in a conversation -> host tracks active and recent state -> later follow-up turns select the right summary without leaking unrelated app context.

## Architecture Decisions

- Decision:
  Track multiple app instances at the host level with explicit active/recent precedence rules.
- Alternatives considered:
- Only support one app instance per conversation
- Rely on prompt text alone to infer which app a follow-up means
- Rationale:
  Multi-app continuity is one of the core grader behaviors, and it requires explicit attribution logic before scale-out.

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
- Multiple-app conversation continuity tests
- Active/recent precedence coverage
- Attribution behavior for later follow-up turns
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
