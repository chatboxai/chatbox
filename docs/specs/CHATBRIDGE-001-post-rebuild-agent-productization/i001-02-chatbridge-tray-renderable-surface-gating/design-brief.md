# I001-02 Design Brief

## Metadata

- Story ID: I001-02
- Story Title: ChatBridge tray renderable-surface gating
- Author: Codex
- Date: 2026-04-02

## Audience / Entry Context

- Primary audience:
  Chatbox users who are continuing a conversation after ChatBridge evaluates or
  launches an app-capable request
- What brings them to this surface now:
  they just received either a real app runtime or an inline route decision in a
  live chat thread
- What they likely know before landing:
  they understand the conversation context but do not necessarily know the
  internal difference between an app artifact and a docked runtime
- What they need to decide or do next:
  either keep interacting with a real runtime, or read an inline decision and
  continue chatting without shell noise

## Desired Feeling

- Primary feeling to create:
  relevance and trust
- Secondary feelings to support:
  calm continuity and clear control
- Feelings to avoid:
  phantom state, duplicated explanation, and false affordance
- Why this emotional posture fits the story:
  the shell should never imply that an app is open when there is nothing to
  control

## Design Language Translation

- Cue 1:
  only show dock-style chrome for genuinely docked content
- Cue 2:
  let inline route receipts read as conversation artifacts, not mini apps
- Cue 3:
  keep the session shell visually quiet when the runtime is absent
- Cue 4:
  prefer subtraction over replacement
- Cue 5:
  preserve existing Chatbox tone and component language
- Anti-cues to avoid:
  blank containers, generic instructional paragraphs, or CTA buttons that point
  to an app surface that does not exist

## System Direction

- Neutral role:
  existing Chatbox background and border tokens
- Primary role:
  the tray remains a host-owned runtime dock
- Secondary role:
  inline route artifacts remain first-class chat content
- Accent role:
  status chips only when they describe a real current state
- Typography posture:
  match the existing restrained shell hierarchy
- Component or surface character:
  utilitarian, explicit, and low-drama

## Layout Metaphor

- Physical-object or editorial analogy:
  a dock appears only when there is a tool on the desk; receipts stay in the
  notebook
- Why this metaphor fits:
  it distinguishes "live controllable surface" from "history or explanation"
- Variation axis 1:
  strict docking gate versus permissive docking with lighter chrome
- Variation axis 2:
  preserve inline receipts verbatim versus trim duplicated helper copy
- Variation axis 3:
  central shared classifier versus ad hoc guardrails in each component

## Copy Direction

- Copy change status:
  small edit
- Voice and tone:
  direct and operational
- Naming posture:
  keep "app tray" language only for real docked runtimes
- CTA posture:
  show focus or restore actions only when they can reveal a real surface
- Real draft copy required before design-grade review:
  no
- If no, why:
  the primary design change is suppressing incorrect chrome, not inventing new
  marketing or UX copy

## Constraints / No-Go Decisions

- Scope constraints:
  no broad ChatBridge shell redesign
- Content constraints:
  keep route-artifact reasoning intact
- Accessibility constraints:
  do not expose dead-end controls
- Implementation constraints:
  reuse current tokens and shell patterns
- Explicit no-go decisions:
  do not hide route artifacts entirely and do not introduce a second tray
  system just for special cases

## Design Prompt Inputs

- Prompt phrase 1:
  dock only real runtime surfaces
- Prompt phrase 2:
  inline receipts stay in chat
- Prompt phrase 3:
  no phantom app affordances
- Prompt phrase 4:
  subtract irrelevant chrome before adding anything new
- Prompt phrase 5:
  match current Chatbox shell language
