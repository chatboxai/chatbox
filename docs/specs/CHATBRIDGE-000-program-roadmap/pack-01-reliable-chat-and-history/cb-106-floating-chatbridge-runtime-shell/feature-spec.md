# CB-106 Feature Spec

## Metadata

- Story ID: CB-106
- Story Title: Floating ChatBridge runtime shell
- Author: Codex
- Date: 2026-04-02
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 01 - Reliable Chat and History

## Problem Statement

The current ChatBridge runtime surface is anchored inline inside the message
thread. Once the user continues chatting, the live app viewport scrolls away,
which makes game and app control awkward because the user has to scroll back up
to see the active runtime.

## Story Pack Objectives

- Higher-level pack goal: keep the chat/session shell reliable enough for
  persistent app-backed interaction.
- Pack primary objectives: O1, O2
- How this story contributes to the pack: it upgrades the Pack 01 host-owned app
  shell from an inline-only message object to a session-level runtime host that
  can stay visible while chat continues.

## User Stories

- As a user, I want the active game or app to stay visible while I continue
  controlling it from chat.
- As a user, I want the conversation thread to keep the durable app record
  without forcing the live runtime viewport to stay buried in scrollback.
- As the host, I want one canonical session-level surface for active app
  runtimes instead of duplicating app chrome in every message.

## Acceptance Criteria

- [ ] AC-1: When a reviewed app reaches `launching`, `ready`, or `active`, the
  session shows a floating host-owned runtime shell outside the scrollback and
  near the active conversation controls.
- [ ] AC-2: The message thread keeps a compact app anchor or receipt for the
  same app instance, including status and a clear “focus/open app” affordance.
- [ ] AC-3: The user can minimize or restore the floating runtime shell without
  losing the message-level anchor.
- [ ] AC-4: The shell behaves responsively: desktop uses a floating dock-style
  surface, and small-screen/mobile uses a bottom-sheet or equivalent anchored
  presentation.
- [ ] AC-5: Only one app runtime is floated at a time, and host-owned
  selection rules for which app is floated are explicit and testable.
- [ ] AC-6: Accessibility coverage exists for focus handoff, restore/minimize
  controls, and keyboard reachability of the floated runtime shell.

## Edge Cases

- Empty/null inputs: sessions with no app parts must render exactly as today.
- Boundary values: multiple active or ready app instances in one thread must
  resolve deterministically to one floated runtime.
- Invalid/malformed data: malformed or stale app parts must fail closed to the
  compact message receipt instead of pinning a broken floating surface.
- External-service failures: launch timeout or degraded recovery must keep the
  compact message artifact visible even if the floating shell dismisses.

## Non-Functional Requirements

- Security: the floating shell must not bypass host-owned lifecycle or bridge
  controls.
- Performance: the docked surface must not destabilize message-list scrolling or
  introduce heavy rerender churn.
- Observability: shell promotion, minimize, restore, and dismissal decisions
  should be traceable if they alter visible runtime behavior.
- Reliability: session reload should be able to recover the appropriate floated
  runtime from host-owned message/app state.

## UI Requirements

- This is a visible UI story and must go through Pencil review before code.
- The design should treat the floating surface as host-owned session chrome, not
  as a freeform draggable OS-style window.
- The message-thread anchor must remain compact and conversation-friendly.

## Out of Scope

- Replacing the underlying message `app` part persistence contract
- Multi-window or multi-app simultaneous floating surfaces
- Full Pack 05 flagship runtime implementation for Drawing Kit or Weather

## Done Definition

- The session shell shows the approved floating runtime behavior.
- The thread still keeps a compact durable artifact for the active app instance.
- Responsive and accessibility behavior are covered by tests.
- Validation passes for the touched scope.
- Seeded example data is refreshed if the visible default ChatBridge experience
  changes; otherwise the handoff must state why no refresh was needed.
