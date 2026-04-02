# CB-505 Constitution Check

## Story Context

- Story ID: CB-505
- Story Title: Default reviewed app catalog parity for flagship apps
- Pack: Pack 05 - Multi-App Routing and Debate Arena
- Owner: Codex
- Date: 2026-04-02

## Constraints

1. Keep reviewed-app membership explicit and host-owned; do not turn this into
   a dynamic marketplace or implicit discovery mechanism.
   Source: `chatbridge/PRESEARCH.md`
2. Follow the repo's four-artifact story contract for standard-lane work.
   Source: `.ai/skills/spec-driven-development.md`
3. Preserve existing reviewed-app manifest and eligibility contracts rather
   than inventing per-app exceptions.
   Sources: `src/shared/chatbridge/`, `chatbridge/ARCHITECTURE.md`
4. Keep the change inside shared catalog and routing seams instead of seed-only
   fixtures.
   Sources: `src/shared/chatbridge/reviewed-app-catalog.ts`,
   `src/renderer/packages/chatbridge/router/`
5. Preserve the repo validation baseline when implementation begins.
   Source: `package.json`

## Structural Map

- Likely surface: `src/shared/chatbridge/reviewed-app-catalog.ts`
- Likely surface: `src/shared/chatbridge/index.ts`
- Likely surface: `src/renderer/packages/chatbridge/router/`
- Likely surface: `test/integration/chatbridge/scenarios/`

## Exemplars

1. `src/shared/chatbridge/reviewed-app-catalog.ts`
   Current default catalog seam to extend.
2. `src/shared/chatbridge/eligibility.ts`
   Eligibility precedent that consumes reviewed catalog entries.
3. `src/renderer/packages/chatbridge/router/candidates.ts`
   Router-facing candidate derivation seam.
4. `test/integration/chatbridge/scenarios/reviewed-app-eligibility.test.ts`
   Existing multi-app inventory and eligibility proof shape.

## Lane Decision

- Lane: `standard`
- Why: this story changes shared runtime inventory and cross-cutting routing
  inputs rather than a narrow leaf component.
- Required gates: constitution check, feature spec, technical plan, task
  breakdown, and focused TDD during implementation.

## Outcome Notes

- Opened from `smoke-audit-master.md` finding SA-001.
- This story should land before the live invocation and route-artifact rebuilds
  so those later stories operate on the correct flagship inventory.
