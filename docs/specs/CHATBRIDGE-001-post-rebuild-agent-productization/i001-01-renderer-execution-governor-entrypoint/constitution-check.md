# I001-01 Constitution Check

## Story Context

- Story ID: I001-01
- Story Title: Renderer execution governor entrypoint and reviewed-route adoption
- Initiative: CHATBRIDGE-001 Post-rebuild agent productization
- Phase: I001 Unified execution governor
- Owner: Codex
- Date: 2026-04-02

## Constraints

1. Start the post-rebuild initiative from one clear execution-governor seam,
   not from a backend-authoritative rewrite.
   Source:
   `docs/specs/CHATBRIDGE-001-post-rebuild-agent-productization/technical-plan.md`
2. Keep the work in the repo's standard-lane four-artifact story contract.
   Source:
   `.ai/skills/spec-driven-development.md`
3. Preserve the existing typed routing, reviewed-launch, and bridge contracts
   instead of replacing them with a parallel runtime model.
   Sources:
   `src/shared/chatbridge/`,
   `src/renderer/packages/chatbridge/`,
   `docs/specs/CHATBRIDGE-001-post-rebuild-agent-productization/technical-plan.md`
4. Keep the story trace-driven because it changes orchestration, routing, tool
   mounting, and output normalization behavior.
   Source:
   `.ai/workflows/trace-driven-development.md`
5. Preserve the repo validation baseline and the default full GitHub flow once
   the story is done.
   Sources:
   `AGENTS.md`, `package.json`

## Structural Map

- Likely shared contract surface:
  `src/shared/chatbridge/governor-contract.ts`
- Likely renderer runtime surface:
  `src/renderer/packages/chatbridge/runtime/`
- Current caller seam:
  `src/renderer/packages/model-calls/stream-text.ts`
- Existing reviewed-route/tool seam:
  `src/renderer/packages/chatbridge/single-app-tools.ts`
- Existing launch normalization seam:
  `src/renderer/packages/chatbridge/reviewed-app-launch.ts`
- Proof surfaces:
  `src/renderer/packages/model-calls/*.test.ts`
  `src/renderer/packages/chatbridge/**/*.test.ts`
  `test/integration/chatbridge/scenarios/`

## Exemplars

1. `src/renderer/packages/model-calls/stream-text.ts`
   The current top-level orchestration seam that still owns too much reviewed
   runtime behavior directly.
2. `src/renderer/packages/chatbridge/single-app-tools.ts`
   Existing reviewed route-decision and tool-preparation seam to adopt rather
   than replace.
3. `src/renderer/packages/chatbridge/reviewed-app-launch.ts`
   Existing launch normalization seam that should remain the output boundary.
4. `src/renderer/packages/chatbridge/bridge/host-controller.ts`
   Lower-level host lifecycle seam that this story should not rewrite.
5. `test/integration/chatbridge/scenarios/live-reviewed-app-invocation.test.ts`
   Existing runtime proof for invoke behavior that this story should preserve
   through the new governor entrypoint.

## Lane Decision

- Lane: `standard`
- Why:
  this story introduces a new runtime seam, changes orchestration ownership,
  and needs trace-backed proof rather than a narrow mechanical edit.
- Required gates:
  constitution check, feature spec, technical plan, task breakdown, trace-aware
  tests, full repo validation, and GitHub finalization.

## Outcome Notes

- This is the first bounded implementation story under `CHATBRIDGE-001`.
- It intentionally does not pull forward `I002` backend-authoritative state,
  `I003` operator surfaces, or any later policy / verification work.
