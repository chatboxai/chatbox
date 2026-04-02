# CB-506 Constitution Check

## Story Context

- Story ID: CB-506
- Story Title: Live reviewed app invocation path beyond Chess
- Pack: Pack 05 - Multi-App Routing and Debate Arena
- Owner: Codex
- Date: 2026-04-02

## Constraints

1. Keep reviewed-app invocation host-owned and policy-aware rather than
   allowing model output to choose arbitrary runtime paths.
   Source: `chatbridge/PRESEARCH.md`, `chatbridge/ARCHITECTURE.md`
2. Follow the repo's four-artifact story contract for standard-lane work.
   Source: `.ai/skills/spec-driven-development.md`
3. Consume the reviewed catalog and route decision seams instead of building a
   new out-of-band launcher.
   Sources: `src/shared/chatbridge/`, `src/renderer/packages/chatbridge/router/`
4. Reuse the existing ChatBridge shell and bridge/runtime surfaces instead of
   inventing standalone app panels.
   Sources: `src/renderer/components/chatbridge/`,
   `src/renderer/packages/chatbridge/bridge/`
5. Preserve the repo validation baseline when implementation begins.
   Source: `package.json`

## Structural Map

- Likely surface: `src/renderer/packages/model-calls/stream-text.ts`
- Likely surface: `src/renderer/packages/chatbridge/single-app-tools.ts`
- Likely surface: `src/renderer/packages/chatbridge/router/`
- Likely surface: `src/renderer/components/chatbridge/`
- Likely surface: `test/integration/chatbridge/scenarios/`

## Exemplars

1. `src/renderer/packages/model-calls/stream-text.ts`
   Current live generation seam that still needs repair.
2. `src/renderer/packages/chatbridge/router/decision.ts`
   Reviewed route-decision precedent the live invoke path should consume.
3. `src/renderer/packages/chatbridge/bridge/host-controller.ts`
   Host-owned runtime launch/control seam to use instead of one-off shortcuts.
4. `test/integration/chatbridge/scenarios/route-decision-artifacts.test.ts`
   Existing decision proof that should become runtime-relevant after this
   rebuild.

## Lane Decision

- Lane: `standard`
- Why: this story changes orchestration, runtime boundaries, and user-visible
  launch behavior across the main chat path.
- Required gates: constitution check, feature spec, technical plan, task
  breakdown, focused TDD during implementation, and smoke verification.

## Outcome Notes

- Opened from `smoke-audit-master.md` finding SA-002.
- This story depends on catalog truth and bridge runtime adoption before it can
  make the live prompt path honest.
