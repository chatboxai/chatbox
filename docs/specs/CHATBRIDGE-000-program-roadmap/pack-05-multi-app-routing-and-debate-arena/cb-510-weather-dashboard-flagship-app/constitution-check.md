# CB-510 Constitution Check

## Story Context

- Story ID: CB-510
- Story Title: Weather Dashboard flagship app
- Pack: Pack 05 - Multi-App Routing and Debate Arena
- Owner: Codex
- Date: 2026-04-02

## Constraints

1. Keep external data access host-owned and reviewed; the app runtime must not
   have direct unbounded fetch authority.
   Source: `chatbridge/ARCHITECTURE.md`
2. Follow the repo's four-artifact story contract for standard-lane work.
   Source: `.ai/skills/spec-driven-development.md`
3. Preserve the reviewed-partner model while adding a no-auth, data-backed
   flagship app.
   Source: `chatbridge/PRESEARCH.md`
4. Visible UI changes require Pencil review and explicit approval before code.
   Sources: `.ai/docs/PENCIL_UI_WORKFLOW.md`, `.ai/workflows/pencil-ui-design.md`
5. Preserve the repo validation baseline when implementation begins.
   Source: `package.json`

## Structural Map

- Likely surface: `src/shared/chatbridge/`
- Likely surface: `src/main/chatbridge/`
- Likely surface: `src/renderer/components/chatbridge/apps/`
- Likely surface: `src/renderer/packages/chatbridge/`
- Likely surface: `design/stories/`
- Likely surface: `test/integration/chatbridge/scenarios/`

## Exemplars

1. `src/main/chatbridge/resource-proxy/`
   Host-owned external action precedent, even though Weather does not use user
   auth.
2. `src/shared/chatbridge/recovery-contract.ts`
   Degraded-state precedent to reuse for upstream failures.
3. `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
   Inline app rendering precedent.
4. `src/shared/models/tracing.ts`
   Observability precedent for traced external-data flows.

## Lane Decision

- Lane: `standard`
- Why: this story adds a new data-backed flagship app, external host boundary,
  and visible UI behavior across multiple layers.
- Required gates: constitution check, feature spec, technical plan, task
  breakdown, Pencil review before UI code, focused TDD during implementation,
  and manual smoke verification.

## Outcome Notes

- This story assumes Weather Dashboard is an active flagship app with no user
  auth and host-owned external data access.
- Keep provider selection abstracted so future weather vendor changes do not
  reshape the app shell contract.
