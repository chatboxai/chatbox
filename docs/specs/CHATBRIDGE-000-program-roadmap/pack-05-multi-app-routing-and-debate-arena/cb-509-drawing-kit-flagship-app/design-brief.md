# CB-509 Design Brief

## Metadata

- Story ID: CB-509
- Story Title: Drawing Kit flagship app
- Author: Codex
- Date: 2026-04-02

## Audience / Entry Context

- Primary audience: A ChatBridge user who wants to doodle, play a quick sketch
  round, or riff on a playful drawing prompt directly from a normal
  conversation turn without leaving the thread.
- What brings them to this surface now: The host has routed the request to
  Drawing Kit because the user wants a playful in-thread doodle challenge,
  quick sketch game, or lightweight drawing prompt.
- What they likely know before landing: They understand they are still inside
  Chatbox and expect the host to keep the session state and recovery path
  trustworthy.
- What they need to decide or do next: Start with a blank canvas or a prompt
  seed, choose a lightweight drawing mode, sketch a few strokes, checkpoint the
  result, and either complete or resume the session later.

## Desired Feeling

- Primary feeling to create: Playful and immediate.
- Secondary feelings to support: Expressive, trustworthy, and host-guided.
- Feelings to avoid: Generic whiteboard SaaS, detached iframe toy, dense
  design-tool dashboard, serious diagramming workspace, or anything that feels
  like "productivity software with a canvas bolted on."
- Why this emotional posture fits the story: Drawing Kit has to prove an
  interactive visual app can feel native inside chat while still making the
  host-owned lifecycle obvious.

## Design Language Translation

- Cue 1: Doodle game tray inside the conversation, not a full-screen
  productivity app.
- Cue 2: The canvas should feel ready to use on first glance, even when blank.
- Cue 3: Tool choices should be few, obvious, and tactile rather than
  professional-editor dense.
- Cue 4: Host checkpoints and completion should read like trusted narrative
  milestones, not hidden autosave internals.
- Cue 5: Recovery states should stay inside the same shell and preserve the
  user’s sense of continuity.
- Cue 6: The surface should suggest playful doodling, prompt-based sketching,
  and small unlockable moments rather than polished illustration work.
- Cue 7: Follow-up chat continuity should feel like handing a sketch back to
  the conversation.
- Cue 8: The first glance should read as a round-based game with a canvas,
  not as a compact editor or workspace.
- Anti-cues to avoid: Figma clone chrome, raw canvas debug panels, generic
  dashboard cards, opaque local-only state, or a sterile classroom diagram
  tool.

## System Direction

- Neutral role: Stay within the current Chatbox token system and ChatBridge app
  shell language.
- Primary role: The doodle surface and its active round state should dominate
  the composition.
- Secondary role: Prompt status, simple tool controls, checkpoint summary, and
  completion actions should support the flow without overwhelming the canvas.
- Accent role: Use accent treatments sparingly for active tool selection,
  checkpoint status, and completion or recovery CTAs.
- Typography posture: Clean and contemporary with enough warmth for creative
  work, but still clearly part of the host product.
- Component or surface character: Softly instrumented doodle-game card with
  compact controls, visible host state, and no detached utility panes.

## Layout Metaphor

- Physical-object or editorial analogy: Portable doodle pad nested inside a
  guided conversation card.
- Why this metaphor fits: The user needs one dominant place to play through a
  sketch prompt and one supporting place to understand host-owned continuity
  without splitting the surface into unrelated regions.
- Round-two correction: The first review pass still read too much like a
  polished app shell, so the next designs should bias harder toward tabletop
  game energy, sticker rewards, chunky controls, and immediate prompt play.
- Variation axis 1: Canvas-first immersion versus canvas-plus-checkpoint
  balance.
- Variation axis 2: Bottom-deck continuity versus sidecar continuity.
- Variation axis 3: Strong host-guided completion framing versus lighter
  creative freedom framing.

## Copy Direction

- Copy change status: substantial
- Voice and tone: Concrete, encouraging, and host-guided without sounding like
  a tutorial.
- Naming posture: Use direct labels like `Brush`, `Marker`, `Undo stroke`,
  `Save checkpoint`, `Resume sketch`, and `Complete session`.
- CTA posture: Simple round verbs like `Save checkpoint`, `Resume round`, and
  `Complete session`, not generic product or file-management language.
- Preferred microcopy motifs: rounds, doodles, stickers, score recaps, weird
  prompts, quick rematches, and playful challenge language.
- Real draft copy required before design-grade review: yes
- If no, why:

## Constraints / No-Go Decisions

- Scope constraints: Inline Drawing Kit app shell plus blank, active doodle
  round, checkpoint, completion, resume, and degraded states only.
- Content constraints: Keep examples centered on a playful doodle challenge or
  sketch prompt instead of advanced illustration features or heavy diagramming.
- Accessibility constraints: Keyboard-reachable controls, visible focus states,
  screen-reader-readable status messaging, and non-pointer fallback actions for
  primary workflow steps.
- Implementation constraints: Build on the existing ChatBridge reviewed-app
  runtime and host-owned summary model; do not introduce a parallel local-only
  persistence system.
- Explicit no-go decisions: No multi-panel pro design app, no export/share
  workflow, no collaborator presence UI, no hidden checkpoint semantics, no
  serious diagram-builder posture, and no recovery flow that ejects the user
  from the thread.

## Pencil Prompt Inputs

- inline doodle-game canvas inside chat
- host-guided sketch round with checkpoint continuity
- playful drawing prompts with compact tool controls
- creative but bounded drawing kit for chatbridge
- recovery and resume states that stay inside one conversation card
