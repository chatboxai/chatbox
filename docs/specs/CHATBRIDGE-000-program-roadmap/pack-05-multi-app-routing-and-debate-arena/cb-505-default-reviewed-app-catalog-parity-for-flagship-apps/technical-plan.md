# CB-505 Technical Plan

## Metadata

- Story ID: CB-505
- Story Title: Default reviewed app catalog parity for flagship apps
- Author: Codex
- Date: 2026-04-02

## Proposed Design

- Components/modules affected:
  - `src/shared/chatbridge/reviewed-app-catalog.ts`
  - `src/shared/chatbridge/index.ts`
  - `src/renderer/packages/chatbridge/router/candidates.ts`
  - `src/renderer/packages/chatbridge/router/decision.ts`
  - `src/renderer/packages/chatbridge/single-app-tools.ts`
- Public interfaces/contracts:
  - default reviewed-app catalog entry contract
  - manifest/eligibility metadata required for flagship apps
  - distinction between catalog presence and later launch/runtime readiness
- Data flow summary:
  fresh runtime loads default reviewed catalog -> eligible flagship entries are
  visible to routing and launch selection -> later stories decide invoke,
  clarify, refuse, or auth/runtime behavior from that complete set.

## Architecture Decisions

- Decision:
  treat default flagship inventory as checked-in reviewed catalog truth rather
  than something only seeds and tests know.
- Alternatives considered:
  - keep non-Chess apps seeded-only until later runtime work lands
  - build ad hoc per-story registry overrides outside the shared catalog
- Rationale:
  later routing and Story Builder rebuilds are invalid if the runtime still
  starts from the wrong inventory.

## Data Model / API Contracts

- Request shape:
  catalog entries should keep using the reviewed-app manifest contract already
  expected by eligibility and routing.
- Response shape:
  routing and launch code should be able to see the flagship entries without
  special-case seed-only injection.
- Storage/index changes:
  none by default; this is a checked-in runtime configuration and contract
  parity change.

## Dependency Plan

- Existing dependencies used:
  reviewed manifest contract, eligibility filters, route decision helpers, and
  single-app tool selection seams
- New dependencies proposed (if any):
  none
- Risk and mitigation:
  keep catalog expansion explicit and reviewed; do not imply that catalog
  presence alone proves launch readiness or auth readiness

## Test Strategy

- Unit tests:
  - default catalog includes required flagship entries
  - malformed catalog entries fail validation
- Integration tests:
  prove fresh runtime routing can see Debate Arena and Story Builder as
  candidates before later invoke/auth decisions are applied
- E2E or smoke tests:
  rerun fresh-prompt smoke checks that previously refused because only Chess was
  present
- Edge-case coverage mapping:
  duplicate entries, missing metadata, and policy-denied entries should be
  covered explicitly

## UI Implementation Plan

- Behavior logic modules:
  keep this story in shared/router logic, not presentational UI components
- Component structure:
  no new components by default
- Accessibility implementation plan:
  no direct UI scope
- Visual regression capture plan:
  not required unless later work introduces visible discovery changes

## Rollout and Risk Mitigation

- Rollback strategy:
  keep catalog expansion isolated to the reviewed catalog and routing seams
- Feature flags/toggles:
  not required by default
- Observability checks:
  emit or log enough structured state to distinguish catalog presence from
  later route, launch, or auth failures

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
