# CB-705 Constitution Check

## Story Context

- Story ID: CB-705
- Story Title: Platform-wide error handling and recovery
- Pack: Pack 07 - Policy, Safety, and Partner DX
- Owner: Codex
- Date: 2026-03-30

## Constraints

1. This story must explicitly cover the requested priority step for timeouts,
   crashes, and invalid tool calls.
   Source: requested build strategy
2. Preserve the conversation even when app/runtime flows fail.
   Source: `chatbridge/ARCHITECTURE.md`
3. Keep recovery behavior host-owned and observable.
   Source: `chatbridge/PRESEARCH.md`

## Structural Map

- `src/shared/chatbridge/`
- `src/renderer/components/chatbridge/`
- `src/renderer/packages/chatbridge/`
- `src/renderer/packages/model-calls/stream-text.ts`

## Exemplars

1. `docs/specs/CHATBRIDGE-000-program-roadmap/pack-04-completion-and-app-memory/cb-404-degraded-completion-and-recovery-ux/feature-spec.md`
2. `src/renderer/packages/model-calls/stream-text.ts`
3. `chatbridge/ARCHITECTURE.md`

## Lane Decision

- Lane: `standard`
- Why: this is a cross-cutting lifecycle and recovery story affecting multiple
  runtime boundaries.
- Required gates: full four-artifact packet.
