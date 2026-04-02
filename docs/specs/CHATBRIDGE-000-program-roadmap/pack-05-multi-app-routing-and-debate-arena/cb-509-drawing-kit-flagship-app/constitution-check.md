# CB-509 Constitution Check

## Story Context

- Story ID: CB-509
- Story Title: Drawing Kit flagship app
- Pack: Pack 05 - Multi-App Routing and Debate Arena
- Owner: Codex
- Date: 2026-04-02

## Constraints

1. Keep Drawing Kit inside the reviewed-partner, host-owned runtime model.
   Source: `chatbridge/PRESEARCH.md`, `chatbridge/ARCHITECTURE.md`
2. Follow the repo's four-artifact story contract for standard-lane work.
   Source: `.ai/skills/spec-driven-development.md`
3. Keep model-visible state bounded and normalized rather than exposing raw UI
   event streams.
   Sources: `chatbridge/ARCHITECTURE.md`, `src/shared/chatbridge/summary.ts`
4. Visible UI changes require Pencil review and explicit approval before code.
   Sources: `.ai/docs/PENCIL_UI_WORKFLOW.md`, `.ai/workflows/pencil-ui-design.md`
5. Preserve the repo validation baseline when implementation begins.
   Source: `package.json`

## Structural Map

- Likely surface: `src/shared/chatbridge/`
- Likely surface: `src/renderer/components/chatbridge/apps/`
- Likely surface: `src/renderer/packages/chatbridge/`
- Likely surface: `design/stories/`
- Likely surface: `test/integration/chatbridge/scenarios/`

## Exemplars

1. `src/renderer/components/chatbridge/apps/chess/`
   Current interactive no-auth flagship precedent for inline app behavior.
2. `src/shared/chatbridge/completion.ts`
   Completion-contract precedent to reuse.
3. `src/renderer/packages/context-management/app-context.ts`
   Host-visible context precedent for later-turn continuity.
4. `test/integration/chatbridge/scenarios/chess-runtime-legal-move-engine.test.tsx`
   Inline interactive app proof pattern to mirror.

## Lane Decision

- Lane: `standard`
- Why: this story adds a new flagship app, visible UI, and shared lifecycle
  state rather than a narrow isolated component.
- Required gates: constitution check, feature spec, technical plan, task
  breakdown, Pencil review before UI code, focused TDD during implementation,
  and manual smoke verification.

## Outcome Notes

- This story assumes Debate Arena is legacy and Drawing Kit is the new active
  second flagship app.
- Drawing Kit should share the host lifecycle contract rather than inventing a
  parallel app state model.
