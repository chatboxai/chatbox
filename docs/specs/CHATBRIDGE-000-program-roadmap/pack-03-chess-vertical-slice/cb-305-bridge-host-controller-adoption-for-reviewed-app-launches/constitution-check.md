# CB-305 Constitution Check

## Story Context

- Story ID: CB-305
- Story Title: Bridge host controller adoption for reviewed app launches
- Pack: Pack 03 - Chess Vertical Slice
- Owner: Codex
- Date: 2026-04-02

## Constraints

1. Keep this story aligned with the reviewed-partner architecture instead of
   introducing a second app-runtime system.
   Source: `chatbridge/PRESEARCH.md`, `chatbridge/ARCHITECTURE.md`
2. Follow the repo's four-artifact story contract for standard-lane work.
   Source: `.ai/skills/spec-driven-development.md`
3. Preserve host ownership over app launch, lifecycle, completion, and
   recovery state.
   Source: `chatbridge/ARCHITECTURE.md`
4. Extend existing renderer and bridge seams rather than building a new hidden
   runtime path.
   Sources: `src/renderer/packages/chatbridge/`, `src/renderer/components/chatbridge/`
5. Preserve the repo validation baseline when implementation begins.
   Source: `package.json`
6. If visible launch/loading/recovery UI changes exceed the existing shell
   patterns, reopen Pencil before final UI code.
   Sources: `.ai/docs/PENCIL_UI_WORKFLOW.md`, `.ai/workflows/pencil-ui-design.md`

## Structural Map

- Likely surface: `src/renderer/packages/chatbridge/bridge/`
- Likely surface: `src/renderer/components/chatbridge/`
- Likely surface: `src/renderer/components/Artifact.tsx`
- Likely surface: `test/integration/chatbridge/scenarios/`

## Exemplars

1. `src/renderer/packages/chatbridge/bridge/host-controller.ts`
   Current bridge launch control and event normalization seam.
2. `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
   Current host-owned rendering seam for ChatBridge runtime content.
3. `src/renderer/components/Artifact.tsx`
   Preview artifact precedent that must remain explicitly separate.
4. `test/integration/chatbridge/scenarios/bridge-session-security.test.ts`
   Existing bridge lifecycle and validation proof seam.

## Lane Decision

- Lane: `standard`
- Why: this story changes shared runtime boundaries and cross-cutting launch
  behavior rather than a narrow isolated component.
- Required gates: constitution check, feature spec, technical plan, task
  breakdown, focused TDD during implementation, and targeted smoke tracing.

## Outcome Notes

- Opened from `smoke-audit-master.md` finding SA-005.
- This story should be completed before deeper live multi-app and Story Builder
  runtime rewiring so those later stories can stand on one real launch seam.
