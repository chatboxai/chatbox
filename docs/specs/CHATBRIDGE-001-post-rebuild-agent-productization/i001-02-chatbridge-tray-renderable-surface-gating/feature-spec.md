# I001-02 Feature Spec

## Metadata

- Story ID: I001-02
- Story Title: ChatBridge tray renderable-surface gating
- Author: Codex
- Date: 2026-04-02
- Related initiative:
  `docs/specs/CHATBRIDGE-001-post-rebuild-agent-productization/`

## Problem Statement

The ChatBridge session tray currently appears for any recent app part that has
an `appId`, `appInstanceId`, and a floatable lifecycle. That rule is broader
than the actual renderer surface contract. As a result, inline-only route
artifacts and other non-surface app parts can be promoted into the tray and
into the message-level anchor state even though there is no real app surface to
show.

This creates empty or misleading tray chrome, duplicate explanatory copy, and
"Focus app" or "Restore app" actions for artifacts that should have stayed in
the chat timeline.

## Story Objectives

- Initiative goal:
  tighten post-rebuild ChatBridge runtime truth so visible shell behavior
  matches what the renderer can actually display.
- How this story contributes:
  it defines one shared tray-eligibility rule for renderable app surfaces and
  keeps non-surface artifacts inline.

## User Stories

- As a user, I want the app tray to appear only when there is a real app
  surface worth keeping docked outside scrollback.
- As a user, I want route receipts and chat-only decisions to remain simple
  inline chat artifacts instead of pretending an app is open.
- As a maintainer, I want tray selection, message anchors, and shell copy to
  derive from one explicit presentation contract rather than duplicated
  heuristics.

## Acceptance Criteria

- [ ] AC-1: The session-level ChatBridge tray only mounts when the selected app
      part resolves to a tray-eligible renderable surface, not merely when the
      part has a floatable lifecycle.
- [ ] AC-2: When an app part is not tray-eligible, the message timeline keeps
      the part inline and does not switch it into the compact anchor shell.
- [ ] AC-3: Clarify, refuse, runtime-unsupported, and other inline-only route
      artifacts remain visible in chat but never surface "Focus app",
      "Restore app", or generic tray copy.
- [ ] AC-4: The tray-eligibility rule is defined in one shared helper or
      contract and reused by tray target resolution plus message presentation,
      so future app parts cannot drift into phantom shell states.
- [ ] AC-5: Focused coverage exists for at least one tray-eligible runtime and
      at least one inline-only route artifact, proving the tray fails closed
      when nothing renderable exists.
- [ ] AC-6: The eventual implementation story updates ChatBridge seed and lab
      fixtures when needed so the new behavior is visible in seeded audits. If
      no seed change is needed, the handoff must state that explicitly.

## Edge Cases

- Empty/null inputs:
  sessions with no app parts or only text/info parts must continue rendering
  without tray chrome.
- Boundary values:
  when the most recent app part for an instance is stale or non-renderable, the
  tray must fail closed even if an older message for that instance was
  renderable.
- Invalid/malformed data:
  malformed route-artifact values or missing state must stay inline and must not
  claim a docked runtime exists.
- Mixed histories:
  conversations with both a real runtime and later inline route receipts must
  keep the real runtime logic deterministic and must not let the later receipt
  steal the tray.

## Non-Functional Requirements

- Reliability:
  the tray and anchor state must derive from the same rule so reloads and
  rerenders do not oscillate between inline and docked modes.
- Maintainability:
  surface eligibility should be testable without rendering a React node as the
  primary contract.
- Accessibility:
  keyboard users and screen readers should not encounter dock/restore controls
  when no docked runtime exists.
- Performance:
  the new contract should be a lightweight pure check that does not add heavy
  session-level work.

## UI Requirements

- This is a visible ChatBridge shell story.
- The tray should behave like host-owned runtime chrome only for real dockable
  app surfaces.
- Inline route receipts should keep their existing in-chat posture and should
  not inherit generic runtime-tray language.

## Out of Scope

- Rewriting the general ChatBridge shell visual language
- Redesigning real runtime tray copy for every existing app
- Changing reviewed routing policy, route-decision ranking, or app launch
  semantics
- Moving renderer-owned runtime state into a backend-authoritative model

## Done Definition

- A shared renderable-surface rule governs tray mounting and anchor mode.
- Non-surface artifacts no longer produce phantom tray UI.
- Focused tests cover tray-eligible and inline-only paths.
- Seed and lab follow-up requirements are explicit for the implementation story.
- Validation passes for the eventual implementation diff.
