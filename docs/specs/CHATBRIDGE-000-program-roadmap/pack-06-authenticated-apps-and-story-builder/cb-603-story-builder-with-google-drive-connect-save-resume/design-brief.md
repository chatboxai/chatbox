# CB-603 Design Brief

## Metadata

- Story ID: CB-603
- Story Title: Story Builder with Google Drive connect/save/resume
- Author: Codex
- Date: 2026-04-01

## Audience / Entry Context

- Primary audience: A ChatBridge user resuming a creative writing task from the
  conversation, often after the host has suggested Story Builder for outlining
  or drafting.
- What brings them to this surface now: They want to connect Google Drive, keep
  drafting without leaving the thread, or return to a previously saved chapter
  checkpoint.
- What they likely know before landing: They understand they are still inside
  Chatbox and expect the host to manage auth and recovery rather than dropping
  them into a raw third-party screen.
- What they need to decide or do next: Connect Drive if needed, continue the
  draft, save a checkpoint, reopen the latest checkpoint, or complete the
  writing pass and return to normal chat.

## Desired Feeling

- Primary feeling to create: Focused and dependable.
- Secondary feelings to support: Editorial, calm, and clearly host-guided.
- Feelings to avoid: Generic productivity dashboard, raw file-manager UI, or
  an iframe-like embedded web app.
- Why this emotional posture fits the story: This is the authenticated proof
  app for Pack 06, so it must feel creative and usable while still making host
  authority and save/resume confidence obvious.

## Design Language Translation

- Cue 1: Writing desk rather than admin console.
- Cue 2: Chapter-oriented workspace with obvious checkpoint rhythm.
- Cue 3: Connection status should read like a trusted host capability, not a
  settings detour.
- Cue 4: Save and resume affordances should feel explicit and recoverable.
- Cue 5: Editorial composition beats tool-heavy chrome.
- Cue 6: Drive presence should be recognizable but subordinate to the host
  shell.
- Cue 7: Completion should feel like handing a finished draft back to the
  conversation, not closing a modal.
- Anti-cues to avoid: Spreadsheet density, browser-like file listings, generic
  empty states, or heavy Google product mimicry.

## System Direction

- Neutral role: Stay inside the current Chatbox token system and ChatBridge shell
  language.
- Primary role: The draft canvas, chapter title, and next action hierarchy
  should dominate the surface.
- Secondary role: Save state, Drive connection state, and checkpoint metadata
  should support the workflow without overwhelming the page.
- Accent role: Use the existing Chatbox accent treatments to call attention to
  connect, save, resume, and complete actions only.
- Typography posture: Editorial and readable, with enough warmth for creative
  work but no decorative flourish that weakens clarity.
- Component or surface character: Writing cards, checkpoint strips, and
  connected-state notices should feel like part of one host-owned studio.

## Layout Metaphor

- Physical-object or editorial analogy: Annotated writing desk inside a guided
  studio tray.
- Why this metaphor fits: The user needs one place to write, one place to see
  whether Drive is connected, and one place to trust what is saved or resumable.
- Variation axis 1: Single-canvas writing focus versus split-pane checkpoint
  visibility.
- Variation axis 2: Strong host guidance versus lighter editorial workspace.
- Variation axis 3: Resume-first composition versus draft-first composition.

## Copy Direction

- Copy change status: substantial
- Voice and tone: Calm, concrete, and host-guided.
- Naming posture: Use direct labels like `Connect Drive`, `Saved checkpoint`,
  `Resume draft`, and `Complete session`.
- CTA posture: Clear workflow verbs instead of vague product language.
- Real draft copy required before design-grade review: yes
- If no, why:

## Constraints / No-Go Decisions

- Scope constraints: Story Builder app shell and its auth, editing, save,
  resume, degraded, and completion states only.
- Content constraints: Keep copy centered on drafting a story chapter or scene,
  not generic document management.
- Accessibility constraints: Keyboard reachability, clear connection/save
  status, readable draft hierarchy, and strong state contrast for auth or
  degraded flows.
- Implementation constraints: Build on the existing ChatBridge shell and app
  surface patterns; do not introduce a new visual system or direct Drive client
  behavior in the renderer.
- Explicit no-go decisions: No raw Google Drive file browser clone, no detached
  settings-panel auth flow, no placeholder lorem-ipsum writing copy, and no
  modal-first workflow that breaks in-thread continuity.

## Pencil Prompt Inputs

- authenticated writing desk inside chat
- host-guided story drafting with drive connection
- clear save and resume checkpoint rhythm
- editorial story workspace with trustworthy status
- chatbridge story builder with explicit recovery and completion
