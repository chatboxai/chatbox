# CB-106 Design Brief

## Metadata

- Story ID: CB-106
- Story Title: Floating ChatBridge runtime shell
- Author: Codex
- Date: 2026-04-02

## Audience and Entry Context

- Primary audience:
  users actively controlling a ChatBridge game or app while continuing the
  conversation in the same session
- Entry context:
  an app has already launched or is launching from a thread message, and the
  user continues typing below instead of staying anchored to the original app
  message

## Desired Feeling

- Active, immediate, and controlled
- More like a live companion console than a buried chat attachment
- Stable and host-owned rather than playful popup chrome

## Feelings to Avoid

- Generic modal
- Detached browser window
- Heavy enterprise control panel
- Fragile overlay that feels like it could cover or fight the chat UI

## Design-Language Translation

- Concrete cues:
  - the active app should feel “docked” into the session, not stapled to one
    old message
  - thread artifacts should compress into compact anchor cards with a clear
    focus or restore action
  - the live runtime should sit close to the composer and latest turn context
  - host status, minimize, and “back to source” controls should read as clean
    utility chrome
- Anti-cues:
  - freeform desktop-window mimicry
  - thick error-prone split panes
  - visually noisy multi-rail debugging chrome

## System Direction

- Color roles:
  stay inside the current Chatbox neutral surfaces with controlled blue/emerald
  accents for active or healthy app state
- Typography posture:
  keep the existing Chatbox editorial hierarchy; the dock should not introduce a
  separate product-brand voice
- Component character:
  rounded host shell, compact action row, restrained badges, and compact anchor
  receipts in-thread

## Layout Metaphor

- Core metaphor:
  “docked live surface above the controls, breadcrumb in the thread”
- Variation axes:
  - how much of the dock feels like a persistent tray versus a compact sticky
    card
  - whether the message anchor is receipt-like, collapsed-card-like, or
    thread-rail-like
  - how explicit the host chrome is around the live runtime

## Copy Direction

- Copy fidelity target:
  draft, using real host-style labels rather than lorem ipsum
- Copy posture:
  concise operational labels such as `Active app`, `Minimize`, `Return to
  message`, `Resume runtime`, `Launch timed out`
- If a variation shows helper text, it should explain the shell relationship
  clearly: the thread keeps history, the dock keeps the live surface visible

## Constraints and No-Go Decisions

- Do not design this as a draggable floating OS window.
- Do not remove the in-thread artifact completely; the thread still needs a
  durable app record.
- Do not force the dock to occupy half the screen by default.
- Desktop and small-screen behavior must both be explicit.
- Reuse the current Chatbox design system instead of inventing a new visual
  language for app control.

## Prompt-Ready Pencil Inputs

- Design a Chatbox session screen where a reviewed app runtime remains visible
  in a floating host-owned dock above the composer while the chat thread keeps a
  compact anchor card for the same app instance.
- Show one desktop-oriented variation as a sticky dock card, one as a split
  lower tray, and one as a lighter minimized-first interpretation.
- Keep the visual language consistent with existing Chatbox neutral surfaces and
  rounded cards.
- Include host utility controls: minimize, restore/focus, and return to source
  message.
- Show how degraded or timeout state would remain understandable without losing
  the live-control metaphor.
