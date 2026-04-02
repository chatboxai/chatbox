# CB-507 Constitution Check

## Story Context

- Story ID: CB-507
- Story Title: Live route clarify refuse artifacts and actions
- Pack: Pack 05 - Multi-App Routing and Debate Arena
- Owner: Codex
- Date: 2026-04-02

## Constraints

1. Keep route decisions host-owned, explicit, and explainable rather than
   implicit model behavior.
   Source: `chatbridge/PRESEARCH.md`, `chatbridge/ARCHITECTURE.md`
2. Follow the repo's four-artifact story contract for standard-lane work.
   Source: `.ai/skills/spec-driven-development.md`
3. Treat clarify/refuse as timeline artifacts with durable structured payloads
   rather than plain text hacks.
   Sources: `src/shared/chatbridge/routing.ts`,
   `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
4. Visible UI changes require Pencil review and explicit approval before code.
   Sources: `.ai/docs/PENCIL_UI_WORKFLOW.md`, `.ai/workflows/pencil-ui-design.md`
5. Preserve the repo validation baseline when implementation begins.
   Source: `package.json`

## Structural Map

- Likely surface: `src/shared/chatbridge/routing.ts`
- Likely surface: `src/renderer/packages/chatbridge/router/decision.ts`
- Likely surface: `src/renderer/components/chatbridge/`
- Likely surface: `src/renderer/components/chat/Message.tsx`
- Likely surface: `design/stories/`

## Exemplars

1. `src/shared/chatbridge/routing.ts`
   Current route-decision contract precedent.
2. `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
   Existing structured message-part renderer precedent.
3. `src/renderer/components/chat/Message.tsx`
   Timeline interaction and persistence rendering precedent.
4. `test/integration/chatbridge/scenarios/route-decision-artifacts.test.ts`
   Existing test proof to make live-runtime relevant.

## Lane Decision

- Lane: `standard`
- Why: this story changes visible product behavior, persisted artifacts, and
  action handling across the main chat timeline.
- Required gates: constitution check, feature spec, technical plan, task
  breakdown, Pencil review before UI code, focused TDD during implementation,
  and manual smoke verification.

## Outcome Notes

- Opened from `smoke-audit-master.md` finding SA-003.
- This story should follow the catalog and live invocation backfills so the
  clarify and refusal states plug into a working reviewed-app runtime.
