# CB-007 Technical Plan

## Metadata

- Story ID: CB-007
- Story Title: Trace evidence quality and scriptable smoke inspection
- Author: Codex
- Date: 2026-04-02

## Proposed Design

- Components/modules affected:
  - `src/shared/models/tracing.ts`
  - `src/main/adapters/langsmith.ts`
  - `src/renderer/dev/chatbridgeManualSmoke.ts`
  - `src/renderer/components/dev/ChatBridgeSeedLab.tsx`
  - `test/integration/chatbridge/scenarios/scenario-tracing.ts`
  - `src/shared/chatbridge/live-seeds.ts`
  - `src/renderer/packages/initial_data.ts`
  - `chatbridge/EVALS_AND_OBSERVABILITY.md`
- Public interfaces/contracts:
  - smoke trace metadata/tag contract
  - traceable manual-smoke result contract
  - scriptable seed/preset inventory contract
- Data flow summary:
  supported smoke entrypoint -> smoke helper determines support state -> parent
  trace starts with family/runtime metadata -> smoke helper returns trace id or
  explicit non-traceable reason -> audit tooling and humans can inspect the
  current seed/preset inventory through a stable helper.

## Architecture Decisions

- Decision:
  split evidence-quality hardening into a follow-on Pack 00 story instead of
  widening `CB-006` while it is already in flight.
- Alternatives considered:
  - keep adding more scope to `CB-006`
  - defer trace labeling/scriptability until after runtime rebuilds
- Rationale:
  the delta smoke pass surfaced real observability and audit-tooling gaps, but
  they are separable from the initial "supported smoke path exists" work.

## Data Model / API Contracts

- Request shape:
  smoke-trace helpers should accept scenario slug, scenario family, runtime
  target, and support-state metadata explicitly.
- Response shape:
  manual-smoke helpers should return a result object that includes either a
  trace id/run label or a documented non-traceable reason.
- Storage/index changes:
  none required for product data; add helper seams rather than persisting new
  operational state.

## Dependency Plan

- Existing dependencies used:
  LangSmith adapter contract, `CB-006` smoke helper seam, scenario suite,
  seed lab, live seed catalog, preset bundles, and checked-in smoke ledger
- New dependencies proposed (if any):
  none by default
- Risk and mitigation:
  keep evidence labels sanitized and avoid introducing new runtime coupling to
  renderer storage just to support scripted inspection.

## Test Strategy

- Unit tests:
  - smoke helper result shape and support gating
  - scriptable seed/preset inventory helper behavior
- Integration tests:
  - representative scenario families should assert distinct trace metadata or
    family labeling when tracing is enabled
- E2E or smoke tests:
  - supported manual smoke flow should hand back a trace id or explicit
    unsupported-state outcome in the seed lab or helper surface
- Edge-case coverage mapping:
  unsupported runtime targets, missing LangSmith config, repeated runs, and
  inspection outside renderer storage should all be covered explicitly

## UI Implementation Plan

- Behavior logic modules:
  keep trace-handoff and support-state logic in dev helpers rather than product
  runtime components
- Component structure:
  seed-lab changes should remain dev-only and stay within the existing card
  workflow
- Accessibility implementation plan:
  any new dev-lab status or trace readout should preserve existing semantics
- Visual regression capture plan:
  not required unless the seed lab gains new visible evidence controls

## Rollout and Risk Mitigation

- Rollback strategy:
  keep evidence-quality changes additive and isolated from product runtime
- Feature flags/toggles:
  reuse dev-only gating where possible
- Observability checks:
  verify the new traces land with distinct names plus metadata/tags and still
  remain sanitized

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
