# CB-511 Feature Spec

## Metadata

- Story ID: CB-511
- Story Title: Native stateful chat-app integration
- Author: Codex
- Date: 2026-04-02
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 05 - Multi-App Routing and Debate Arena

## Problem Statement

ChatBridge can currently launch reviewed apps, persist bounded snapshots, and
inject host-approved summaries into later turns. That is enough for continuity,
but not enough for a more native in-thread experience where the assistant can
inspect the current app state, issue deterministic commands, reason over a
fresh screenshot, or expose richer history without leaving the host-owned
boundary.

The user expectation is now higher:

- Chess should move pieces when asked, explain the current board, and expose
  the move ledger directly from chat.
- The host should be able to show the model what the user currently sees,
  including a screenshot when structured state alone is not enough.
- Drawing Kit should support bounded host-driven actions like draw, erase, tool
  switch, and checkpointing instead of being limited to pointer-only runtime
  interaction.

## Story Pack Objectives

- Higher-level pack goal: make the active flagship apps feel more native and
  bidirectional without weakening the host-owned trust model.
- Pack primary objectives: O1, O2, O3
- How this story contributes to the pack: it turns Pack 05 from "apps can open
  and later be summarized" into "chat and apps can exchange bounded live state
  and commands through native host seams."

## User Stories

- As a user, I want to ask the chess app to make or undo a move without
  manually clicking the board.
- As a user, I want the assistant to be able to inspect what the app currently
  shows so its reasoning stays grounded in the live runtime.
- As a user, I want the chat to show me app history or screenshots when that is
  the clearest way to answer a follow-up.
- As a user, I want Drawing Kit to respond to direct requests like "draw a
  circle," "erase the last mark," or "switch to spray" while keeping the state
  host-owned.

## Acceptance Criteria

- [ ] AC-1: Later-turn app continuity can use a tiered host-approved context
  model made of:
  a text summary,
  a bounded structured state digest,
  and optional screenshot or media references when explicitly requested or
  materially helpful.
- [ ] AC-2: Chess supports deterministic host-owned chat commands for the
  current active instance, including at minimum move, undo, explain, and move
  history reads.
- [ ] AC-3: The host can capture and persist a bounded screenshot artifact for
  a running app instance, link it back to that instance, and expose it to model
  reasoning or thread rendering without inventing a separate architecture.
- [ ] AC-4: Reviewed runtimes can accept bounded host-originated commands
  through the existing bridge family so Drawing Kit can support at least draw,
  erase, tool switch, and checkpoint-bank behavior from chat.
- [ ] AC-5: All app commands, captures, and degraded outcomes remain auditable,
  idempotent where required, and explicitly fail closed when the app instance is
  stale, unavailable, or no longer selected.

## Edge Cases

- Empty/null inputs: "move a piece" without a legal move or target should stay
  explicit and rejected.
- Boundary values: Chess history can be long; Drawing Kit can accumulate many
  marks; screenshot capture must stay bounded in size and frequency.
- Invalid/malformed data: malformed command payloads, stale app IDs, or replayed
  runtime responses must not mutate trusted state.
- External-service failures: screenshot persistence failures or reviewed-runtime
  command timeouts must degrade through the existing host recovery path.
- Ambiguous requests: if the user asks for "the app" while multiple app
  instances exist, the host should target the selected active app or ask for
  clarification instead of guessing silently.

## Non-Functional Requirements

- Security: the model must not receive raw DOM access, arbitrary runtime code
  execution, or unbounded app internals.
- Performance: screenshot capture and structured digest derivation should not
  flood the renderer or bloat stored message state.
- Observability: chat-issued commands, screenshot capture, runtime command
  responses, and fallback paths should appear in app records and traces.
- Reliability: host-issued commands must remain deterministic across reloads
  and should keep app state coherent after resume.

## UI Requirements

- This story likely has visible UI scope once implemented.
- Any new history drawer, screenshot affordance, or app-state inspector must go
  through Pencil before UI code.
- The primary interaction path should remain conversational first; new inline
  controls are optional supporting affordances, not the only path.

## Out of Scope

- Raw unbounded DOM snapshots or arbitrary renderer serialization
- Full freeform vector-editing semantics for Drawing Kit
- Cross-app orchestration where one app controls another app directly
- Continuous video capture or live streaming of runtime pixels
- Non-reviewed partner runtimes or permissions expansion beyond the active
  flagship set

## Done Definition

- The plan is implemented through bounded host-owned seams rather than a new
  runtime architecture.
- Chess and Drawing Kit prove both read-state and write-state integration from
  chat.
- Screenshot/media reasoning is explicit, bounded, and auditable.
- Tests cover read-state injection, command execution, screenshot capture,
  degraded fallbacks, and selected flagship app scenarios.
- Validation passes for the touched scope.
