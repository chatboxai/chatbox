# CB-002 Technical Plan

## Metadata

- Story ID: CB-002
- Story Title: Integration harness and provider fixtures
- Author: Codex
- Date: 2026-03-30

## Proposed Design

- Components/modules affected:
  - `chatbridge/README.md`
  - `chatbridge/INTEGRATION_HARNESS.md`
  - `src/shared/providers/registry.ts`
  - `test/integration/`
  - `test/integration/mocks/model-dependencies.ts`
  - `test/integration/mocks/sentry.ts`
  - future `test/integration/chatbridge/`
  - future partner mock-app fixtures
- Public interfaces/contracts:
  - provider and partner fixture contract
  - local mock-host/runtime harness expectations
  - real-versus-mock integration selection guidance
- Data flow summary:
  later stories use Pack 0 fixtures to exercise host/runtime/provider seams with
  repeatable inputs before depending on every real external integration

## Architecture Decisions

- Decision:
  define mock and integration harness strategy early so contract and lifecycle
  tests have a stable substrate
- Alternatives considered:
  - wait until the first flagship app to invent mocks
  - test only against real providers and partner services
- Rationale:
  platform contracts are easier to validate when fixtures are reusable and
  intentional

## Data Model / API Contracts

- Request shape:
  test harnesses should accept inputs close to real host/provider/app contracts
- Response shape:
  fixtures should surface both happy-path and failure-path behavior
- Storage/index changes:
  starter integration-harness folder and fixture/scenario placeholders

## Starter Harness Plan

- Canonical starter folder:
  `test/integration/chatbridge/`
- Initial checked-in scaffold:
  - `README.md`
  - `fixtures/README.md`
  - `scenarios/README.md`
- Real logic should be added later as host/runtime contracts stabilize, but the
  location and usage rules should be fixed now.

## Dependency Plan

- Existing dependencies used:
  current provider registry and integration test layout
- New dependencies proposed (if any):
  none by default
- Risk and mitigation:
  keep mock contracts aligned to reviewed schemas and real host boundaries

## Test Strategy

- Unit tests:
  fixture and mock contract validation
- Integration tests:
  host/runtime/provider interactions under representative scenarios
- E2E or smoke tests:
  mock flagship flows where real services are not yet available
- Edge-case coverage mapping:
  invalid payloads, offline mode, provider failures, stale runtime state

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
  keep fixtures additive and aligned to real contracts
- Feature flags/toggles:
  use real-versus-mock guidance later where needed
- Observability checks:
  fixture paths should still support trace and lifecycle event visibility

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
