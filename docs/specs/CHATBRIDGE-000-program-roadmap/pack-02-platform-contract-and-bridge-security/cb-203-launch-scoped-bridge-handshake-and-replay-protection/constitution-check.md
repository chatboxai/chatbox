# CB-203 Constitution Check

## Story Context

- Story ID: CB-203
- Story Title: Launch-scoped bridge handshake and replay protection
- Pack: Pack 02 - Platform Contract and Bridge Security
- Owner: Codex
- Date: 2026-03-30

## Constraints

1. Keep this story aligned with the ChatBridge architecture and presearch rather than inventing a parallel platform shape.
Source: `chatbridge/PRESEARCH.md`, `chatbridge/ARCHITECTURE.md`
2. Follow the repo's four-artifact story contract for standard-lane work.
Source: `.ai/skills/spec-driven-development.md`
3. Extend current Chatbox seams rather than bypassing them with isolated prototypes.
Sources: `src/main/chatbridge/`, `src/preload/`, `src/renderer/packages/chatbridge/bridge/`
4. Preserve the repo's validation baseline when implementation begins.
Source: `package.json`
5. Keep ChatBridge host authority explicit for lifecycle, routing, and model-visible memory.
Source: `chatbridge/PRESEARCH.md`
6. UI work should only expand if later implementation reveals a user-facing surface that genuinely needs it.
Source: `AGENTS.md`

## Structural Map

- Actual surface: `src/shared/chatbridge/`
- Actual surface: `src/renderer/packages/chatbridge/bridge/`
- Actual surface: `src/renderer/components/Artifact.tsx`
- Actual surface: `src/renderer/components/chatbridge/chatbridge.ts`

## Exemplars

1. `src/renderer/components/Artifact.tsx`
Current embedded iframe surface and the real ambient bridge seam on `main`.
2. `src/shared/types/session.ts`
Shared schema precedent for durable host-owned contracts.
3. `src/main/mcp/ipc-stdio-transport.ts`
Example of keeping bridge logic in focused modules instead of adding ad hoc
logic inline.
4. `test/integration/chatbridge/scenarios/app-aware-persistence.test.ts`
Existing ChatBridge integration-harness precedent for lifecycle regression
coverage.

## Lane Decision

- Lane: `standard`
- Why: this story changes shared contracts, runtime boundaries, or cross-cutting behavior that affects multiple code paths.
- Required gates: constitution check, feature spec, technical plan, task breakdown, focused TDD during implementation.

## Completion Evidence

- Shared bridge-session contract and replay validation:
  - `src/shared/chatbridge/bridge-session.ts`
- Dedicated renderer bridge path:
  - `src/renderer/packages/chatbridge/bridge/host-controller.ts`
  - `src/renderer/packages/chatbridge/bridge/artifact-runtime.ts`
- Existing UI seam hardened in place:
  - `src/renderer/components/Artifact.tsx`
  - `src/renderer/components/chatbridge/chatbridge.ts`
- Focused tests added:
  - `src/shared/chatbridge/bridge-session.test.ts`
  - `src/renderer/packages/chatbridge/bridge/artifact-runtime.test.ts`
  - `test/integration/chatbridge/scenarios/bridge-session-security.test.ts`
  - `src/renderer/components/chatbridge/ChatBridgeShell.test.tsx`
