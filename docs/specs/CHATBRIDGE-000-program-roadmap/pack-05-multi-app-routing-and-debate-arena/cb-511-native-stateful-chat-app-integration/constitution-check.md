# CB-511 Constitution Check

## Story Context

- Story ID: CB-511
- Story Title: Native stateful chat-app integration
- Pack: Pack 05 - Multi-App Routing and Debate Arena
- Owner: Codex
- Date: 2026-04-02

## Constraints

1. Keep the host as the owner of model-visible app context, lifecycle, and
   side effects.
   Sources:
   `AGENTS.md`,
   `src/shared/chatbridge/app-memory.ts`,
   `src/renderer/packages/chatbridge/context.ts`
2. Reuse the current reviewed-app and host-tool seams before inventing a new
   subsystem.
   Sources:
   `src/shared/chatbridge/tools.ts`,
   `src/shared/chatbridge/manifest.ts`,
   `src/renderer/packages/chatbridge/reviewed-app-launch.ts`
3. Keep app state bounded and normalized; do not promote raw renderer internals
   or unbounded event streams into later-turn context.
   Sources:
   `src/shared/chatbridge/apps/chess.ts`,
   `src/shared/chatbridge/apps/drawing-kit.ts`,
   `docs/specs/CHATBRIDGE-000-program-roadmap/pack-04-completion-and-app-memory/cb-403-active-app-context-injection-for-later-turns/technical-plan.md`
4. Visible tray, inspector, or screenshot UI changes still require the normal
   Pencil gate before code.
   Sources:
   `.ai/docs/PENCIL_UI_WORKFLOW.md`,
   `AGENTS.md`
5. Validation stays at the repo baseline when implementation starts.
   Source:
   `AGENTS.md`

## Structural Map

- Likely surface: `src/shared/chatbridge/`
- Likely surface: `src/main/chatbridge/`
- Likely surface: `src/renderer/packages/chatbridge/`
- Likely surface: `src/renderer/components/chatbridge/`
- Likely surface: `src/shared/types/session.ts`
- Likely surface: `test/integration/chatbridge/scenarios/`

## Exemplars

1. `src/shared/chatbridge/apps/chess.ts`
   Host-owned state contract with legal move history, FEN, PGN, and board
   summary.
2. `src/shared/chatbridge/apps/drawing-kit.ts`
   Bounded creative-state precedent using `previewMarks`, checkpoint summaries,
   and resume hints instead of raw stroke history.
3. `src/shared/chatbridge/tools.ts`
   Existing audited host-tool execution envelope with idempotency and effect
   classification.
4. `src/renderer/packages/chatbridge/chess-session-state.ts`
   Precedent for chat-driven host mutations that persist into message parts and
   app records.
5. `src/renderer/packages/chatbridge/bridge/reviewed-app-runtime.ts`
   Current reviewed runtime surface that can be extended to consume bounded
   host commands.
6. `src/main/chatbridge/resource-proxy/index.ts`
   Existing host-mediated request/response boundary that can be reused for
   screenshots or other explicit runtime resource actions when needed.

## Lane Decision

- Lane: `standard`
- Why: this expands trusted app-context rules, command surfaces, and possible
  runtime media capture across multiple flagship apps. It changes public
  ChatBridge behavior and shared contracts, not just local presentation.
- Required gates: constitution check, feature spec, technical plan, task
  breakdown, focused TDD during implementation, and Pencil review for any new
  visible controls or tray affordances.

## Outcome Notes

- Prefer widening existing host-owned seams over introducing a parallel
  orchestration layer.
- The first implementation cuts should favor read-state and deterministic Chess
  commands before richer reviewed-runtime commands like Drawing Kit draw/erase.
