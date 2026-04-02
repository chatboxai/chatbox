# CB-007 Constitution Check

## Story Context

- Story ID: CB-007
- Story Title: Trace evidence quality and scriptable smoke inspection
- Pack: Pack 00 - Foundation and Instrumentation
- Owner: Codex
- Date: 2026-04-02

## Constraints

1. Keep Pack 00 vendor-neutral at the contract layer even if LangSmith remains
   the current trace sink.
   Source: `chatbridge/EVALS_AND_OBSERVABILITY.md`
2. Preserve the repo's checked-in story packet contract for standard-lane work.
   Source: `.ai/skills/spec-driven-development.md`
3. Do not log raw secrets or arbitrary student content in trace metadata,
   tags, or manual-smoke evidence payloads.
   Sources: `src/shared/utils/langsmith_adapter.ts`, `chatbridge/EVALS_AND_OBSERVABILITY.md`
4. Prefer checked-in dev helpers and shared data seams over renderer-storage
   bootstrapping hacks or local-only shell glue.
   Sources: `src/renderer/components/dev/ChatBridgeSeedLab.tsx`,
   `src/shared/chatbridge/live-seeds.ts`,
   `src/renderer/packages/initial_data.ts`
5. Preserve the repo validation baseline when implementation begins.
   Source: `package.json`

## Structural Map

- Likely surface: `src/shared/models/`
- Likely surface: `src/main/adapters/`
- Likely surface: `src/renderer/dev/`
- Likely surface: `src/renderer/components/dev/`
- Likely surface: `test/integration/chatbridge/scenarios/`
- Likely surface: `chatbridge/EVALS_AND_OBSERVABILITY.md`

## Exemplars

1. `src/shared/utils/langsmith_adapter.ts`
   Existing sanitization and trace adapter precedent.
2. `src/shared/models/tracing.ts`
   Existing wrapped model trace precedent.
3. `src/renderer/components/dev/ChatBridgeSeedLab.tsx`
   Existing live-smoke workflow precedent.
4. `docs/specs/CHATBRIDGE-000-program-roadmap/smoke-audit-master.md`
   Existing audit-led control contract precedent.

## Lane Decision

- Lane: `standard`
- Why: this story changes the checked-in smoke/observability contract across
  runtime helpers, tests, and control docs.
- Required gates: constitution check, feature spec, technical plan, task
  breakdown, focused TDD during implementation.

## Outcome Notes

- This packet exists because the delta smoke pass showed that traces can exist
  while still being too unlabeled or too sparse to guide rebuild work well.
- The implementation story should harden evidence quality without widening into
  product runtime fixes that belong to later packs.
