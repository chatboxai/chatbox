# CB-404 Constitution Check

## Story Context

- Story ID: CB-404
- Story Title: Degraded completion and recovery UX
- Pack: Pack 04 - Completion and App Memory
- Owner: Codex
- Date: 2026-04-01

## Constraints

1. Keep this story aligned with the ChatBridge architecture and presearch rather than inventing a parallel platform shape.
Source: `chatbridge/PRESEARCH.md`, `chatbridge/ARCHITECTURE.md`
2. Follow the repo's four-artifact story contract for standard-lane work.
Source: `.ai/skills/spec-driven-development.md`
3. Extend current Chatbox seams rather than bypassing them with isolated prototypes.
Sources: `src/renderer/components/chatbridge/`, `src/renderer/components/chat/Message.tsx`, `design/stories/`
4. Preserve the repo's validation baseline when implementation begins.
Source: `package.json`
5. Keep ChatBridge host authority explicit for lifecycle, routing, and model-visible memory.
Source: `chatbridge/PRESEARCH.md`
6. Visible UI changes require Pencil MCP review and explicit approval before code.
Sources: `.ai/docs/PENCIL_UI_WORKFLOW.md`, `.ai/workflows/pencil-ui-design.md`

## Structural Map

- Likely surface: `src/renderer/components/chatbridge/`
- Likely surface: `src/renderer/components/chat/Message.tsx`
- Likely surface: `design/stories/`

## Exemplars

1. `src/shared/types/session.ts`
Shared schema precedent for durable conversation state.
2. `src/renderer/components/chat/Message.tsx`
Timeline rendering precedent for new conversation artifacts.
3. `src/renderer/packages/model-calls/stream-text.ts`
Current orchestration/tool-call precedent for host-controlled execution.
4. `src/renderer/components/Artifact.tsx`
Current embedded surface precedent for future host-owned runtime containers.

## Lane Decision

- Lane: `standard`
- Why: this story changes shared contracts, runtime boundaries, or cross-cutting behavior that affects multiple code paths.
- Required gates: constitution check, feature spec, technical plan, task breakdown, focused TDD during implementation, and Pencil review before UI code.

## Outcome Notes

- The approved UI direction was Variation C from the checked-in Pencil review.
- Implementation stayed inside the existing `ChatBridgeShell`, `ChatBridgeMessagePart`, shared app-value contracts, and live seed lab seams.
- No parallel runtime surface or alternate memory channel was introduced; degraded recovery metadata stays host-owned and inline.
