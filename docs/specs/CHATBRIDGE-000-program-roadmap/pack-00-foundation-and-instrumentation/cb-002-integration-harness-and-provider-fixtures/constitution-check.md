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
   Sources:
   `chatbridge/INTEGRATION_HARNESS.md`,
   `docs/specs/CHATBRIDGE-000-program-roadmap/pack-00-foundation-and-instrumentation/README.md`
2. Use current provider and request patterns as the foundation.
   Sources:
   `src/shared/providers/registry.ts`,
   `test/integration/model-provider/model-provider.test.ts`,
   `test/integration/file-conversation/test-harness.ts`
3. Keep later partner/runtime testing in mind when defining fixtures and local
   harnesses.
   Sources:
   `chatbridge/PRESEARCH.md`,
   `chatbridge/INTEGRATION_HARNESS.md`

## Structural Map

 - `chatbridge/INTEGRATION_HARNESS.md`
- `src/shared/providers/registry.ts`
- `src/renderer/packages/remote.ts`
- `test/integration/`
- `test/integration/chatbridge/`

## Exemplars

1. `chatbridge/INTEGRATION_HARNESS.md`
2. `test/integration/file-conversation/test-harness.ts`
3. `test/integration/model-provider/model-provider.test.ts`

## Lane Decision

- Lane: `standard`
- Why: this story sets cross-cutting integration/test readiness for multiple
  later packs.
- Required gates: full four-artifact packet.
