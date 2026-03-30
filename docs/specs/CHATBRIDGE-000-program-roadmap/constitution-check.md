# CHATBRIDGE-000 Constitution Check

## Story Context

- Story ID: CHATBRIDGE-000
- Story Title: ChatBridge phased roadmap and story-pack plan
- Owner: Codex
- Date: 2026-03-30

## Planning Constraints

1. Keep this work as checked-in planning evidence under `docs/specs/`, not as
   product code or `.ai/`-only memory.
   Source: `AGENTS.md`
2. Treat ChatBridge as an Electron-first extension of Chatbox, not a greenfield
   rewrite.
   Sources: `chatbridge/README.md`, `chatbridge/PRESEARCH.md`,
   `chatbridge/ARCHITECTURE.md`
3. Keep the program aligned with the current repo seams: session/message
   schemas, tool-call rendering, streaming model calls, artifact rendering,
   existing MCP bridge plumbing, and current auth/request layers.
   Sources:
   `src/shared/types/session.ts`,
   `src/renderer/components/chat/Message.tsx`,
   `src/renderer/components/message-parts/ToolCallPartUI.tsx`,
   `src/renderer/packages/model-calls/stream-text.ts`,
   `src/renderer/components/Artifact.tsx`,
   `src/main/mcp/ipc-stdio-transport.ts`,
   `src/preload/index.ts`,
   `src/renderer/packages/remote.ts`,
   `src/shared/request/request.ts`
4. Use the repo's standard planning shape instead of inventing a new artifact
   system.
   Sources:
   `.ai/skills/spec-driven-development.md`,
   `.ai/templates/spec/FEATURE_SPEC_TEMPLATE.md`,
   `.ai/templates/spec/TECHNICAL_PLAN_TEMPLATE.md`,
   `.ai/templates/spec/TASK_BREAKDOWN_TEMPLATE.md`
5. Any visible UI story that comes out of these packs must route through Pencil
   MCP after spec and technical planning and before code.
   Sources:
   `.ai/docs/PENCIL_UI_WORKFLOW.md`,
   `.ai/workflows/pencil-ui-design.md`
6. Validation and later implementation work must stay grounded in the current
   repo commands from `package.json`.
   Source: `package.json`
7. Do not disturb unrelated worktree changes while establishing the planning
   set.
   Source: current `git status --short --branch`

## Structural Map

- Program evidence: `docs/specs/CHATBRIDGE-000-program-roadmap/`
- Existing chat/session truth: `src/shared/types/session.ts`
- Timeline rendering: `src/renderer/components/chat/Message.tsx`
- Tool-call UI precedent: `src/renderer/components/message-parts/ToolCallPartUI.tsx`
- Embedded iframe precedent: `src/renderer/components/Artifact.tsx`
- Streaming/tool composition: `src/renderer/packages/model-calls/stream-text.ts`
- Existing main/preload bridge precedent:
  `src/main/mcp/ipc-stdio-transport.ts`, `src/preload/index.ts`
- Existing remote auth/token precedent:
  `src/renderer/packages/remote.ts`, `src/shared/request/request.ts`
- Likely new ChatBridge domains:
  `src/shared/chatbridge/`,
  `src/renderer/packages/chatbridge/`,
  `src/renderer/components/chatbridge/`,
  `src/main/chatbridge/`,
  `test/integration/chatbridge/`

## Exemplar Set

1. `src/shared/types/session.ts`
   The clearest schema precedent for message parts, session durability, and
   future app-aware extensions.
2. `src/renderer/components/chat/Message.tsx`
   The host timeline entry point where app-backed artifacts must eventually feel
   native.
3. `src/renderer/components/message-parts/ToolCallPartUI.tsx`
   The nearest precedent for structured assistant-visible execution artifacts.
4. `src/renderer/components/Artifact.tsx`
   The current embedded rich-surface precedent and the strongest starting point
   for a host-owned app container.
5. `src/main/mcp/ipc-stdio-transport.ts` plus `src/preload/index.ts`
   The nearest example of a constrained host/runtime bridge in the current app.
6. `src/renderer/packages/remote.ts` plus `src/shared/request/request.ts`
   The nearest example of host-managed token ownership and authenticated
   requests.

## Lane Decision

- Lane: `standard`
- Why: this is a cross-cutting roadmap and architecture planning change that
  spans new runtime domains, security boundaries, auth flows, persistence
  contracts, and multiple future UI stories.
- Implication: use a full planning packet now, then derive normal per-story
  spec folders from each approved pack during implementation.
