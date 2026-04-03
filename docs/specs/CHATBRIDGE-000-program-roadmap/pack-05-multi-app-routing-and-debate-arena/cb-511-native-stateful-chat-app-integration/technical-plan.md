# CB-511 Technical Plan

## Metadata

- Story ID: CB-511
- Story Title: Native stateful chat-app integration
- Author: Codex
- Date: 2026-04-02

## Proposed Design

- Components/modules affected:
  - `src/shared/chatbridge/apps/`
  - `src/shared/chatbridge/app-memory.ts`
  - `src/shared/chatbridge/tools.ts`
  - `src/shared/chatbridge/bridge-session.ts`
  - `src/renderer/packages/chatbridge/`
  - `src/renderer/components/chatbridge/`
  - `src/main/chatbridge/`
  - `src/shared/types/session.ts`
  - `test/integration/chatbridge/scenarios/`
- Public interfaces/contracts:
  - app-specific state-digest builders for model context
  - chat-issued host tool commands against active app instances
  - reviewed-runtime host-command bridge messages
  - app-linked screenshot or media reference contract
- Data flow summary:
  user follow-up targets the active app -> host resolves a bounded app-state
  digest and optional screenshot refs -> model either reads state or issues a
  host command -> host mutates trusted app state directly or routes a bounded
  command through the reviewed runtime -> normalized snapshot and audit records
  persist -> later turns can reason over the updated state.

## Architecture Decisions

- Decision:
  extend the current host-owned summary model into a tiered context model:
  summary first, structured digest second, optional media refs third.
- Alternatives considered:
  - always inject the full raw `snapshot`
  - let the model or iframe inspect the DOM directly
  - add a brand-new app orchestration service outside current ChatBridge seams
- Rationale:
  the current repo already has trusted snapshots, app records, reviewed launch
  flows, host tools, and a resource proxy. Widening those seams is materially
  cheaper and safer than adding another architecture layer.

- Decision:
  implement Chess chat commands as host-native mutations against the persisted
  Chess snapshot before attempting reviewed-runtime command parity.
- Alternatives considered:
  - wait for a generic reviewed-runtime command channel and migrate Chess later
  - simulate clicks into the runtime instead of using the host-owned board
    state
- Rationale:
  Chess already lives as a fully host-owned snapshot and persistence path, so it
  is the fastest low-risk proof for commandable app control from chat.

- Decision:
  represent screenshot capture as an app-linked host artifact instead of a new
  standalone media subsystem.
- Alternatives considered:
  - add a bespoke screenshot database
  - store screenshots only in transient memory
- Rationale:
  Chatbox already has image parts and image-storage references, and
  `MessageAppPart.values` can link those artifacts back to the app instance.

## Data Model / API Contracts

- State digest contract:
  add per-app builders under `src/shared/chatbridge/apps/*` that derive a
  bounded model-facing object from the trusted snapshot.
  Example:
  Chess digest can expose `turn`, `lastMove`, `moveHistory` slice, `status`,
  and a compact board summary.
  Drawing Kit digest can expose `selectedTool`, `status`, `caption`,
  `checkpointSummary`, `previewMarks`, and any bounded recent-action ledger.
- Context selection contract:
  keep `summaryForModel` as the minimum continuity layer, but extend
  `selectChatBridgeAppContexts` and the renderer context builder so selected app
  instances may contribute:
  - summary text
  - structured digest
  - optional media refs when explicitly requested or policy-allowed
- Command contract:
  introduce host command definitions that target an active `appInstanceId` plus
  a bounded `commandName` and validated arguments.
  The initial commands should stay app-specific rather than prematurely forcing
  a universal command vocabulary.
- Runtime bridge contract:
  grow the bridge-session family to support host-to-app command messages for
  reviewed runtimes, aligning with the already-declared manifest-level concepts
  like `host.invokeTool` and `host.syncContext`.
- Screenshot contract:
  persist screenshot artifact references as ordinary host image artifacts plus
  app-linked metadata in the corresponding app part or app-record payload.
  This avoids changing the core message model more than necessary.

## Capability Breakdown

- Phase 1: read-state deepening
  - add bounded app digests for Chess and Drawing Kit
  - allow chat follow-ups to request "current board", "move history", "current
    canvas state", or "latest checkpoint" without depending on raw summaries
- Phase 2: Chess host commands
  - `move`
  - `undo`
  - `explain_position`
  - `read_history`
  These can reuse `persistChessSnapshot` and the existing Chess snapshot
  contract.
- Phase 3: screenshot capture and reasoning
  - capture on explicit request like "show me the current app"
  - optionally capture when structured state is insufficient and policy allows
  - attach or link the resulting image artifact to the relevant app instance
- Phase 4: reviewed-runtime commands for Drawing Kit
  - `select_tool`
  - `draw_mark`
  - `erase_last_mark`
  - `clear_canvas`
  - `bank_checkpoint`
  These should route through a bounded host-command bridge instead of direct DOM
  automation.

## Dependency Plan

- Existing dependencies used:
  reviewed-app manifest catalog,
  host-tool contract,
  app-record event store,
  Chess snapshot persistence,
  Drawing Kit snapshot normalization,
  resource proxy,
  and existing image/message infrastructure.
- New dependencies proposed:
  none by default.
  Prefer browser-native capture paths for renderer-owned canvases and existing
  image persistence flows before considering a new library.
- Risk and mitigation:
  - risk: context bloat from over-sharing app state
    mitigation: tiered digest builders with explicit caps per app
  - risk: command drift across apps
    mitigation: start with app-specific validated commands and only generalize
    repeated patterns later
  - risk: screenshot capture becoming a backdoor to raw app internals
    mitigation: make capture explicit, bounded, and app-linked with audit

## Test Strategy

- Unit tests:
  - app digest builders clamp and normalize state correctly
  - chat command schemas reject malformed or stale targets
  - screenshot metadata builders stay bounded
- Integration tests:
  - active-app context injection includes summary plus structured digest for the
    selected app
  - chat-issued Chess move updates the persisted snapshot and app records
  - screenshot capture links a stored image artifact back to the app instance
  - Drawing Kit host command round-trip updates host state through the reviewed
    bridge path
- E2E or smoke tests:
  - ask Chess to move a piece and verify board plus ledger update
  - ask what the app currently shows and verify screenshot or digest-backed
    response
  - ask Drawing Kit to draw or erase and verify checkpoint continuity
- Edge-case coverage mapping:
  stale instances, duplicate idempotency keys, invalid chess moves, missing
  screenshot artifact persistence, blank canvas commands, and degraded runtime
  timeouts

## UI Implementation Plan

- Behavior logic modules:
  keep app command resolution, screenshot capture, digest building, and context
  selection outside presentational tray components.
- Component structure:
  the chat remains the primary control surface; optional tray/history/screenshot
  affordances should be secondary and app-agnostic where possible.
- Accessibility implementation plan:
  command results, screenshot availability, and degraded states must remain
  screen-reader visible and keyboard reachable.
- Visual regression capture plan:
  if new visible inspector or screenshot surfaces are added, capture tray,
  inline-message, and degraded states after Pencil approval.

## Rollout and Risk Mitigation

- Rollback strategy:
  ship in phases, starting with read-only context and Chess commands before
  reviewed-runtime command writes.
- Feature flags/toggles:
  acceptable for screenshot capture or reviewed-runtime write commands if the
  first cut needs staged rollout.
- Observability checks:
  emit app-record and trace evidence for:
  - chat command requested
  - command accepted or rejected
  - screenshot capture requested and persisted
  - reviewed-runtime command round-trip completed or degraded

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
