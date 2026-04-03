# I001-01 Technical Plan

## Metadata

- Story ID: I001-01
- Story Title: Renderer execution governor entrypoint and reviewed-route adoption
- Author: Codex
- Date: 2026-04-02

## Proposed Design

- Components/modules affected:
  - `src/shared/chatbridge/governor-contract.ts`
  - `src/shared/chatbridge/index.ts`
  - `src/renderer/packages/chatbridge/runtime/execution-governor.ts`
  - `src/renderer/packages/model-calls/stream-text.ts`
  - `src/renderer/packages/chatbridge/single-app-tools.ts`
  - `test/integration/chatbridge/scenarios/`
- Public interfaces/contracts:
  - renderer execution-governor route resolution contract
  - renderer execution-governor trace payload contract
  - governor-owned content-part normalization contract
- Data flow summary:
  base tools assembled in `streamText` -> execution governor consumes reviewed
  routing helpers -> governor emits the reviewed route trace event -> governor
  returns wrapped tools plus any route artifact -> model executes ->
  governor-owned normalization merges info parts, route artifact, and reviewed
  launch parts into the final assistant content.

## Architecture Decisions

- Decision:
  start `I001` in the renderer path by extracting one governor entrypoint
  instead of trying to move bridge lifecycle and durable state in the same
  story.
- Alternatives considered:
  - keep `streamText` as the permanent top-level reviewed runtime owner
  - jump straight to a cross-process governor with backend truth and resume
    authority
- Rationale:
  the initiative technical plan explicitly warns that the governor phase can
  become a rewrite if it does not adopt the current typed seams incrementally.

## Data Model / API Contracts

- Shared contract additions:
  - route resolution shape returned by the governor
  - trace payload shape for `chatbridge.routing.reviewed-app-decision`
  - shared selection-source enum for route provenance
- Storage/index changes:
  none; this is runtime orchestration and contract extraction only.

## Dependency Plan

- Existing dependencies used:
  reviewed route decision helpers, reviewed launch normalization, host-tool
  wrapping, LangSmith adapter, and the current model-call pipeline
- New dependencies proposed:
  none
- Risk and mitigation:
  keep the new governor seam pure and adoptive so tests can cover it directly
  without dragging bridge-session lifecycle into the first slice

## Trace-Driven Scenario Matrix

1. Happy path:
   explicit Drawing Kit request still invokes a reviewed launch through the
   governor seam
2. Happy path:
   natural Chess prompt still reaches the Chess runtime through the governor
3. Expected user ambiguity:
   a mixed weather-plus-drawing prompt produces a clarify artifact
4. Expected chat-only path:
   a dinner prompt produces a refuse artifact
5. Degraded trace path:
   route-decision event recording failure remains non-fatal in the unit seam

## Test Strategy

- Unit tests:
  - governor route preparation and trace payload generation
  - governor content-part normalization
  - governor behavior when tool use is disabled
- Integration tests:
  - live renderer invoke and route-artifact flows through the new seam
- E2E or smoke:
  no new manual-smoke fixture is required for this first slice because the
  visible path remains unchanged; scenario traces are the primary proof

## UI Implementation Plan

- Behavior logic modules:
  place the new seam under `src/renderer/packages/chatbridge/runtime/`
- Component structure:
  unchanged for this story
- Accessibility plan:
  preserve current route-artifact and launch-part rendering behavior

## Rollout and Risk Mitigation

- Rollback strategy:
  the seam extraction should be reversible by swapping `streamText` back to the
  previous inline logic if needed
- Feature flags/toggles:
  none by default
- Observability checks:
  preserve the existing route-decision event name, metadata, and tags so the
  trace search surface does not regress during `I001`

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
