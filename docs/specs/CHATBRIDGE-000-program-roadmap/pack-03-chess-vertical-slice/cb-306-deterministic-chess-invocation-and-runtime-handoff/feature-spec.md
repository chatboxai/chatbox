# CB-306 Feature Spec

## Metadata

- Story ID: CB-306
- Story Title: Deterministic Chess invocation and runtime handoff
- Author: Codex
- Date: 2026-04-02
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 03 - Chess Vertical Slice

## Problem Statement

The current reviewed Chess launch path still produces a generic reviewed-app
launch shell instead of the actual Chess runtime. In practice that means an
explicit Chess tool invocation can render an irrelevant placeholder card and
then degrade into a timeout instead of showing the playable board.

## Story Pack Objectives

- Higher-level pack goal: keep Chess as the proof that ChatBridge can launch a
  real, long-lived in-thread app rather than a placeholder bridge receipt.
- Pack primary objectives: O1, O2
- How this story contributes to the pack: it restores a deterministic Chess
  launch handoff from tool invocation into the actual board runtime while
  keeping the generic reviewed-launch seam available for non-Chess apps.

## User Stories

- As a user, when I explicitly tell ChatBridge to use Chess, I want to see the
  actual Chess board, not a generic launch placeholder.
- As a user, when I provide a FEN or PGN-like Chess request, I want the Chess
  app path to open from that state instead of falling back to generic chat.
- As the host, I want Chess to use the approved in-thread runtime surface while
  other reviewed apps can keep using the generic reviewed-launch bridge until
  their own runtimes are ready.

## Acceptance Criteria

- [ ] AC-1: Explicit Chess/app/tool prompts and common natural Chess prompts
  deterministically select the reviewed Chess tool path.
- [ ] AC-2: A successful `chess_prepare_session` result is converted into a
  real Chess app part with a valid host-owned Chess snapshot, not the generic
  reviewed launch surface.
- [ ] AC-3: The rendered result for a tool-launched Chess request shows the
  actual Chess runtime/board surface inline in the thread.
- [ ] AC-4: Invalid or unsupported launch inputs fail closed and remain
  explicit; they do not silently fabricate trusted board state.
- [ ] AC-5: Generic reviewed-launch behavior remains available for non-Chess
  reviewed apps.

## Edge Cases

- Empty/null inputs: explicit Chess requests without a FEN or PGN still open a
  valid starting position.
- Boundary values: the shorthand `startpos` should normalize to the standard
  starting position.
- Boundary values: raw FEN strings and PGN-like move lists without the literal
  token `chess` should still stay on the Chess path.
- Invalid/malformed data: malformed FEN or PGN input must not create trusted
  board state.
- External-service failures: this story should eliminate bridge-timeout
  dependence for Chess launch while preserving the generic bridge seam for
  other apps.

## Non-Functional Requirements

- Security: only host-authored Chess snapshots may become trusted app state or
  `summaryForModel`.
- Performance: Chess launch should feel faster than the prior generic reviewed
  bridge placeholder path.
- Observability: traces and tests must distinguish Chess direct-runtime
  handoff from generic reviewed-launch handling.
- Reliability: the Chess launch path should no longer depend on a generic
  bridge handshake before the board becomes visible.

## UI Requirements

- Reuse the existing approved Chess runtime surface.
- Do not design a new Chess launch shell for this story.
- The fix should remove irrelevant reviewed-launch placeholder output from the
  Chess path rather than introduce new visual chrome.

## Out of Scope

- Non-Chess live reviewed app invocation beyond the current queue
- Clarify/refuse UI
- Drawing Kit and Weather runtime implementation

## Done Definition

- Tool-launched Chess opens the actual in-thread Chess runtime.
- Common Chess prompt forms deterministically stay on the Chess app path.
- Non-Chess reviewed apps still keep the generic reviewed-launch seam.
- Focused tests and traces cover the happy path and malformed-input path.
- Validation passes for the touched scope.
