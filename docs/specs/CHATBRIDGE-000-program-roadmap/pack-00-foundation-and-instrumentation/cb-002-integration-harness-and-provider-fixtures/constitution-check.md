# CB-002 Constitution Check

## Story Context

- Story ID: CB-002
- Story Title: Integration harness and provider fixtures
- Pack: Pack 00 - Foundation and Instrumentation
- Owner: Codex
- Date: 2026-03-30

## Constraints

1. Integration setup should reduce later story risk, not add one-off demo
   infrastructure.
   Source: requested build strategy
2. Use current provider and request patterns as the foundation.
   Sources:
   `src/shared/providers/registry.ts`,
   `src/renderer/packages/remote.ts`
3. Keep later partner/runtime testing in mind when defining fixtures and local
   harnesses.
   Source: `chatbridge/PRESEARCH.md`

## Structural Map

- `src/shared/providers/registry.ts`
- `src/renderer/packages/remote.ts`
- `test/integration/`
- `chatbridge/`

## Exemplars

1. `src/shared/providers/registry.ts`
2. `test/integration/`
3. `src/renderer/packages/remote.ts`

## Lane Decision

- Lane: `standard`
- Why: this story sets cross-cutting integration/test readiness for multiple
  later packs.
- Required gates: full four-artifact packet.
