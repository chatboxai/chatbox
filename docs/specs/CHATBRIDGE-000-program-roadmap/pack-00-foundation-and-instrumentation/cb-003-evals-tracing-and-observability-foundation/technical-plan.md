# CB-003 Technical Plan

## Metadata

- Story ID: CB-003
- Story Title: Evals, tracing, and observability foundation
- Author: Codex
- Date: 2026-03-30

## Proposed Design

- Components/modules affected:
  - `chatbridge/README.md`
  - `chatbridge/EVALS_AND_OBSERVABILITY.md`
  - `.ai/workflows/feature-development.md`
  - `.ai/workflows/trace-driven-development.md`
  - `src/main/adapters/sentry.ts`
  - `src/renderer/setup/sentry_init.ts`
  - `src/shared/utils/sentry_adapter.ts`
  - `test/integration/mocks/sentry.ts`
  - roadmap pack docs and later ChatBridge instrumentation seams
- Public interfaces/contracts:
  - trace-driven development workflow contract
  - baseline eval fixture expectations
  - lifecycle observability expectations for later packs
- Data flow summary:
  later stories touching routing, tools, lifecycle, completion, or auth first
  establish traces and eval fixtures, then implement against observable seams

## Architecture Decisions

- Decision:
  move evals, traces, and observability into Pack 0 rather than leaving them for
  late operational hardening
- Alternatives considered:
  - rely on tests alone until errors appear
  - defer observability until multi-app or auth work
- Rationale:
  ChatBridge introduces subtle runtime boundaries where trace-driven development
  is valuable much earlier than a typical feature

## Data Model / API Contracts

- Request shape:
  orchestration-heavy stories should define observable lifecycle boundaries and
  traceable correlation points
- Response shape:
  trace records, eval fixtures, and structured lifecycle telemetry expectations
- Storage/index changes:
  documentation-only foundation plus starter guidance for later scenario assets

## Concrete Foundation Expectations

- Required lifecycle checkpoints:
  route, eligibility, app instance start, bridge ready, tool invocation, app
  state update, completion, auth decision, degraded recovery
- Minimum correlation fields:
  `sessionId`, `messageId`, `appId`, `appInstanceId`, `bridgeSessionId`, and
  per-event IDs when relevant
- Privacy rule:
  no raw secrets and no unnecessary raw sensitive content in reusable traces

## Dependency Plan

- Existing dependencies used:
  current feature workflow and ChatBridge architecture docs
- New dependencies proposed (if any):
  none required for the planning/workflow foundation
- Risk and mitigation:
  keep the workflow vendor-neutral and attach concrete instrumentation only when
  a later story needs it

## Test Strategy

- Unit tests:
  future eval fixture and trace-schema helpers
- Integration tests:
  trace capture and lifecycle event verification in later packs
- E2E or smoke tests:
  full lifecycle traces for flagship apps
- Edge-case coverage mapping:
  timeouts, crashes, invalid tool calls, malformed bridge events, auth denial

## UI Implementation Plan

- Behavior logic modules:
  N/A
- Component structure:
  none
- Accessibility implementation plan:
  none
- Visual regression capture plan:
  none

## Rollout and Risk Mitigation

- Rollback strategy:
  trace/eval guidance can deepen incrementally without blocking the roadmap
- Feature flags/toggles:
  later packs may gate heavier instrumentation if needed
- Observability checks:
  future stories should expose enough trace and event detail to explain failures
  without leaking secrets

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
