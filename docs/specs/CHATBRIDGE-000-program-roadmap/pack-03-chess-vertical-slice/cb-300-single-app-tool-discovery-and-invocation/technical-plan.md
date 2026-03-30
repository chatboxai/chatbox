# CB-300 Technical Plan

## Metadata

- Story ID: CB-300
- Story Title: Single-app tool discovery and invocation
- Author: Codex
- Date: 2026-03-30

## Proposed Design

- Components/modules affected:
  - `src/renderer/packages/model-calls/stream-text.ts`
  - `src/shared/models/abstract-ai-sdk.ts`
  - `src/shared/chatbridge/`
  - `src/renderer/packages/chatbridge/`
- Public interfaces/contracts:
  - reviewed single-app discovery and invocation path
  - routing decision into a single approved app tool
  - observable invocation event contract
- Data flow summary:
  natural-language request -> reviewed app/tool selection -> host validation ->
  single-app invocation -> host-visible result or failure

## Architecture Decisions

- Decision:
  make single-app invocation an explicit story gate before broader UI embedding
- Alternatives considered:
  - hide invocation inside the first UI story
  - defer invocation proof until after Chess rendering is polished
- Rationale:
  the requested strategy explicitly places tool invocation before UI embedding

## Data Model / API Contracts

- Request shape:
  approved app/tool selection plus validated invocation args
- Response shape:
  normalized invocation result or host-visible recoverable failure
- Storage/index changes:
  host-side invocation records should be forward-compatible with later tracing
  and completion work

## Dependency Plan

- Existing dependencies used:
  current model/tool orchestration paths plus pack 02 contracts
- New dependencies proposed (if any):
  none by default
- Risk and mitigation:
  keep the first invocation path narrow and well-instrumented

## Test Strategy

- Unit tests:
  routing and arg-validation helpers
- Integration tests:
  single-app tool invocation from chat message through host execution
- E2E or smoke tests:
  minimal natural-language Chess invocation smoke
- Edge-case coverage mapping:
  ambiguous prompt, invalid args, invocation failure

## UI Implementation Plan

- Behavior logic modules:
  keep discovery and invocation in host/runtime logic
- Component structure:
  existing host artifacts are enough for this story
- Accessibility implementation plan:
  any surfaced invocation state should remain readable in the timeline
- Visual regression capture plan:
  not required unless the implementation introduces a new visible state

## Rollout and Risk Mitigation

- Rollback strategy:
  keep invocation wiring bounded to one approved app path
- Feature flags/toggles:
  a scoped single-app enablement flag is acceptable if needed
- Observability checks:
  emit invocation traces and failure signals

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
