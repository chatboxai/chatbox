# CB-006 Constitution Check

## Story Context

- Story ID: CB-006
- Story Title: Traceable ChatBridge manual smoke harness and coverage expansion
- Pack: Pack 00 - Foundation and Instrumentation
- Owner: Codex
- Date: 2026-04-02

## Constraints

1. Keep Pack 00 vendor-neutral at the contract level even if LangSmith is the
   current tracing sink.
   Source: `chatbridge/EVALS_AND_OBSERVABILITY.md`
2. Preserve the repo's checked-in story packet contract for standard-lane work.
   Source: `.ai/skills/spec-driven-development.md`
3. Do not log raw secrets or arbitrary student content in trace payloads.
   Sources: `src/shared/utils/langsmith_adapter.ts`, `chatbridge/EVALS_AND_OBSERVABILITY.md`
4. Prefer existing dev-tool and scenario seams over ad hoc shell scripts that
   bypass the product/runtime contracts.
   Sources: `src/renderer/components/dev/ChatBridgeSeedLab.tsx`, `test/integration/chatbridge/scenarios/`
5. Preserve the repo validation baseline when implementation begins.
   Source: `package.json`

## Structural Map

- Likely surface: `src/main/adapters/`
- Likely surface: `src/renderer/adapters/`
- Likely surface: `src/shared/models/`
- Likely surface: `test/integration/chatbridge/scenarios/`
- Likely surface: `chatbridge/EVALS_AND_OBSERVABILITY.md`

## Exemplars

1. `src/shared/utils/langsmith_adapter.ts`
   Existing sanitization and trace adapter precedent.
2. `src/shared/models/tracing.ts`
   Existing wrapped model trace precedent.
3. `src/main/adapters/langsmith.ts`
   Main-process trace sink precedent.
4. `src/renderer/components/dev/ChatBridgeSeedLab.tsx`
   Existing live-smoke workflow precedent.

## Lane Decision

- Lane: `standard`
- Why: this story changes cross-cutting observability and rebuild workflow
  expectations across runtime, tests, and docs.
- Required gates: constitution check, feature spec, technical plan, task
  breakdown, focused TDD during implementation.

## Outcome Notes

- This packet exists because the smoke audit showed that current trace coverage
  is real but incomplete.
- The implementation story should improve observability without claiming that
  all runtime surfaces are equally traceable when they are not.
