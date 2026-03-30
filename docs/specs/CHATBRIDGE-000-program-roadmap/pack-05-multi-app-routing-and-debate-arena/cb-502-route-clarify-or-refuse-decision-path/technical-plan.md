# CB-502 Technical Plan

## Metadata

- Story ID: CB-502
- Story Title: Route, clarify, or refuse decision path
- Author: Codex
- Date: 2026-03-30

## Proposed Design

- Components/modules affected:
- `src/renderer/packages/chatbridge/router/`
- `src/renderer/components/chatbridge/`
- `src/renderer/components/chat/Message.tsx`
- `design/stories/`
- Public interfaces/contracts:
- Routing decision enum and reason codes
- Clarifier and refusal timeline artifact contract
- Fallback behavior when no confident app route exists
- Data flow summary:
  Prompt arrives -> eligible apps are evaluated -> router returns invoke/clarify/refuse -> timeline renders the right host artifact or proceeds to app launch.

## Architecture Decisions

- Decision:
  Model multi-app routing as an explicit invoke/clarify/refuse decision tree.
- Alternatives considered:
- Always choose the top-ranked app silently
- Refuse too broadly to avoid ambiguity
- Rationale:
  App routing is a UX and safety feature; it needs predictable, explainable behavior instead of hidden heuristics alone.

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
- Confident route behavior
- Clarifier rendering and follow-up behavior
- Refusal behavior for unrelated prompts
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
