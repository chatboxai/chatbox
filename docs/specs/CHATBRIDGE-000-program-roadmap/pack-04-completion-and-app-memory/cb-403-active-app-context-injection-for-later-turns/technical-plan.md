# CB-403 Technical Plan

## Metadata

- Story ID: CB-403
- Story Title: Active app context injection for later turns
- Author: Codex
- Date: 2026-03-30

## Proposed Design

- Components/modules affected:
- `src/renderer/packages/context-management/`
- `src/renderer/packages/model-calls/stream-text.ts`
- `src/renderer/packages/chatbridge/`
- `src/shared/chatbridge/live-seeds.ts`
- Public interfaces/contracts:
- Active/recent app selection rules
- Context injection contract for model messages
- Fallback rules for stale/missing app context
- Data flow summary:
  User follow-up arrives -> host selects active or relevant recent app summary -> context-management assembles a bounded model context -> assistant responds with app-aware continuity.
- Implemented data flow:
  `Session.chatBridgeAppRecords` -> bounded selection in
  `context-management/app-context.ts` -> system-prompt injection in
  `stream-text.ts` -> later-turn model response with explicit active/recent or
  unavailable app context.

## Architecture Decisions

- Decision:
  Inject bounded host-approved app summaries into later turns rather than raw app state snapshots.
- Alternatives considered:
- Always inject full app state
- Ignore app context after completion
- Rationale:
  Good conversational continuity depends on relevant app context, but safe orchestration depends on that context being bounded and host-authored.

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
- Active app context selection
- Recent-but-not-active app continuity behavior
- Stale context fallback behavior
- Integration tests:
  cover the full host/runtime path touched by this story rather than only isolated helpers
- Implemented test surfaces:
  `src/renderer/packages/context-management/app-context.test.ts`
  and
  `test/integration/chatbridge/scenarios/active-app-context-injection.test.ts`
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
