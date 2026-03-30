# CB-304 Technical Plan

## Metadata

- Story ID: CB-304
- Story Title: Completion, resume, and end-of-game summary
- Author: Codex
- Date: 2026-03-30

## Proposed Design

- Components/modules affected:
- `src/shared/chatbridge/completion.ts`
- `src/shared/chatbridge/instance.ts`
- `src/renderer/components/chatbridge/`
- `design/stories/`
- Public interfaces/contracts:
- Chess completion payload and result summary
- Resume/interrupted-session host behavior
- Post-game timeline artifact behavior
- Data flow summary:
  Chess runtime reaches game end or interruption -> host receives completion/resume signal -> instance state updates -> timeline and later turns use structured summary.

## Architecture Decisions

- Decision:
  Model Chess completion as an explicit host event with resumable lifecycle states.
- Alternatives considered:
- Infer completion from UI state
- Treat interrupted games as silent failures
- Rationale:
  Completion semantics are one of the core architectural risks called out in the presearch, so the first flagship app must prove them rigorously.

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
- Completion event processing
- Interrupted/resume behavior
- Later-turn post-game context retrieval
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
