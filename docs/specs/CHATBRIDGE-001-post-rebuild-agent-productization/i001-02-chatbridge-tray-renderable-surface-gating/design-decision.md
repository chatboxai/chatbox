# I001-02 Design Decision

## Metadata

- Story ID: I001-02
- Story Title: ChatBridge tray renderable-surface gating
- Author: Codex
- Date: 2026-04-02

## Inputs Used

- Design brief:
  `docs/specs/CHATBRIDGE-001-post-rebuild-agent-productization/i001-02-chatbridge-tray-renderable-surface-gating/design-brief.md`
- Design research:
  `docs/specs/CHATBRIDGE-001-post-rebuild-agent-productization/i001-02-chatbridge-tray-renderable-surface-gating/design-research.md`
- Relevant repo exemplars:
  `src/renderer/components/chatbridge/apps/surface.tsx`
  `src/renderer/components/chatbridge/floating-runtime.ts`
  `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`

## Success Rubric

- Criterion 1:
  tray appears only when a real dockable surface exists
- Criterion 2:
  inline route receipts remain clear and complete
- Criterion 3:
  no dead-end controls or phantom state language
- Criterion 4:
  consistency with existing Chatbox shell patterns
- Criterion 5:
  low implementation risk and high testability
- Criterion 6:
  clear behavior for mixed histories and stale parts
- Criterion 7:
  minimal scope expansion beyond the reported problem

## Options Considered

### Option A

- Thesis:
  keep the current tray-selection rule but shorten the empty tray copy
- Strengths:
  smallest visual delta and lowest code churn
- Risks:
  still presents phantom tray state, keeps dead-end affordances, and leaves the
  root contract mismatch in place
- Rubric score:
  3/7

### Option B

- Thesis:
  add one explicit tray-eligibility classifier, float only real dockable
  surfaces, and keep route receipts inline
- Strengths:
  fixes the root cause, keeps the UX honest, and is easy to test across tray,
  anchor, and inline states
- Risks:
  requires touching multiple presentation seams in one coordinated slice
- Rubric score:
  7/7

### Option C

- Thesis:
  always show an app tray container, but collapse non-surface parts into a tiny
  informational receipt inside the tray
- Strengths:
  preserves a stable layout slot for the tray area
- Risks:
  still wastes space, confuses "artifact" with "runtime", and broadens the UX
  contract unnecessarily
- Rubric score:
  4/7

## Chosen Direction

- Winner:
  Option B
- Why it won:
  it is the only option that removes the false tray state instead of decorating
  it. The tray becomes a truthful indicator of a real runtime surface, and
  route receipts stay where they already make sense: inline in the timeline.
- Why the other options lost:
  Option A hides symptoms without fixing the drift. Option C invents a new
  shell mode that the user did not ask for and that the current design system
  does not need.

## Copy Fidelity

- Status:
  draft
- Notes:
  the design direction primarily removes incorrect shell copy and controls. Any
  follow-up text edits should stay minimal and operational.

## Implementation Implications

- Components:
  add a shared surface classifier and adopt it in tray selection plus anchor
  presentation
- Layout:
  the tray disappears entirely when no dockable surface exists
- States:
  route receipts and other inline-only artifacts remain in `inline`
  presentation
- Tokens:
  reuse the existing shell tokens; no new visual system work is needed
- Tests:
  cover tray-eligible, inline-only, mixed-history, and stale-part cases
