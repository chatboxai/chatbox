# CB-000 Constitution Check

## Story Context

- Story ID: CB-000
- Story Title: Workspace bootstrap and env contract
- Pack: Pack 00 - Foundation and Instrumentation
- Owner: Codex
- Date: 2026-03-30

## Constraints

1. Foundation work must happen before the ChatBridge product packs begin.
   Source: requested build strategy
2. Keep the plan grounded in current repo bootstrap, auth, and request seams.
   Sources:
   `package.json`,
   `src/renderer/packages/remote.ts`,
   `src/shared/request/request.ts`
3. Prefer existing stack and repo conventions over new platform tooling unless a
   real gap is proven.
   Sources:
   `AGENTS.md`,
   `.ai/docs/SINGLE_SOURCE_OF_TRUTH.md`
4. The output must stay in spec artifacts, not implementation code.
   Source: `AGENTS.md`

## Structural Map

- `package.json`
- `src/renderer/packages/remote.ts`
- `src/shared/request/request.ts`
- `chatbridge/README.md`
- `docs/specs/CHATBRIDGE-000-program-roadmap/`

## Exemplars

1. `package.json`
2. `src/renderer/packages/remote.ts`
3. `src/shared/request/request.ts`

## Lane Decision

- Lane: `standard`
- Why: this is foundation planning for secrets, env, and integration readiness
  across later packs.
- Required gates: full four-artifact packet before any bootstrap
  implementation.
