# CB-204 Technical Plan

## Metadata

- Story ID: CB-204
- Story Title: Host-coordinated tool execution contract
- Author: Codex
- Date: 2026-03-30

## Proposed Design

- Components/modules affected:
- `src/renderer/packages/model-calls/stream-text.ts`
- `src/shared/models/abstract-ai-sdk.ts`
- `src/shared/chatbridge/tools.ts`
- Public interfaces/contracts:
- Tool execution envelope and result contract
- Retry and idempotency metadata
- Schema-version compatibility rules
- Data flow summary:
  Orchestrator selects a reviewed app tool -> host validates schema/version -> host executes or delegates safely -> normalized result is logged and returned to the app/runtime path.

## Architecture Decisions

- Decision:
  Treat the host as the authoritative execution coordinator for app tools.
- Alternatives considered:
- Let the partner app own execution fully
- Treat partner tools exactly like existing generic model tools
- Rationale:
  Safety, schema compatibility, retry policy, and auditability all depend on the host having explicit execution authority.

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
- Schema mismatch rejection
- Idempotency and retry classification behavior
- Normalized logging payload coverage
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
