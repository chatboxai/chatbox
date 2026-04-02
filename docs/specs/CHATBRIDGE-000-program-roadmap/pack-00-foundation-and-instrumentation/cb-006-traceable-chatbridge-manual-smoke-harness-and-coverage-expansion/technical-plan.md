# CB-006 Technical Plan

## Metadata

- Story ID: CB-006
- Story Title: Traceable ChatBridge manual smoke harness and coverage expansion
- Author: Codex
- Date: 2026-04-02

## Proposed Design

- Components/modules affected:
  - `src/main/adapters/langsmith.ts`
  - `src/renderer/adapters/langsmith.ts`
  - `src/shared/models/tracing.ts`
  - `test/integration/chatbridge/scenarios/`
  - `src/renderer/components/dev/ChatBridgeSeedLab.tsx`
  - `chatbridge/EVALS_AND_OBSERVABILITY.md`
- Public interfaces/contracts:
  - supported smoke trace naming contract
  - manual-smoke runtime prerequisites
  - scenario-to-trace coverage matrix
- Data flow summary:
  supported smoke entrypoint -> reviewed app runtime or seeded-session flow ->
  parent chain trace -> child model/tool traces -> audit ledger / rebuild story

## Architecture Decisions

- Decision:
  define one supported traceable smoke path instead of assuming every runtime
  surface can emit traces equally.
- Alternatives considered:
  - keep tracing test-only
  - keep relying on the web smoke path even though it lacks `electronAPI`
- Rationale:
  we need a trustworthy evidence path for rebuild work. A smaller supported
  path is better than pretending all local surfaces are equally observable.

## Data Model / API Contracts

- Request shape:
  smoke helpers should declare scenario name, runtime target, and expected trace
  family explicitly.
- Response shape:
  helpers should return trace ids or a documented reason the run is non-traced.
- Storage/index changes:
  none expected beyond dev-only fixtures or checked-in docs.

## Dependency Plan

- Existing dependencies used:
  LangSmith adapter contract, existing seed lab, scenario suite, and checked-in
  audit ledger
- New dependencies proposed (if any):
  none by default
- Risk and mitigation:
  avoid widening trace payloads; keep secrets redacted and prefer named smoke
  seams over broad automatic logging

## Test Strategy

- Unit tests:
  - trace helper behavior and any new adapter gating logic
- Integration tests:
  - representative ChatBridge scenarios should assert that their trace family is
    emitted when tracing is enabled
- E2E or smoke tests:
  - supported manual smoke flow documented and rerunnable from the seed lab or
    a dedicated helper
- Edge-case coverage mapping:
  missing LangSmith config, unsupported runtime target, and duplicate smoke
  runs should all produce explicit operator-facing outcomes

## UI Implementation Plan

- Behavior logic modules:
  smoke orchestration should stay in helpers/dev tooling rather than product UI
- Component structure:
  any seed-lab additions should remain dev-only and narrow
- Accessibility implementation plan:
  preserve current dev-tool accessibility; no user-facing runtime change should
  be introduced casually
- Visual regression capture plan:
  not required unless the seed lab gains a new visible workflow element

## Rollout and Risk Mitigation

- Rollback strategy:
  keep changes additive and dev-facing
- Feature flags/toggles:
  reuse existing dev-only gating where possible
- Observability checks:
  verify new smoke traces land in the intended project and remain sanitized

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
