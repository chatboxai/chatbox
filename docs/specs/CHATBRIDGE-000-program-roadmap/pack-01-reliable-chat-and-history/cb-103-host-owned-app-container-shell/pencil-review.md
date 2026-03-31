# CB-103 Pencil Review

## Metadata

- Story ID: CB-103
- Story Title: Host-owned app container shell
- Author: Codex
- Date: 2026-03-31

## Spec References

- Feature spec: `docs/specs/CHATBRIDGE-000-program-roadmap/pack-01-reliable-chat-and-history/cb-103-host-owned-app-container-shell/feature-spec.md`
- Technical plan: `docs/specs/CHATBRIDGE-000-program-roadmap/pack-01-reliable-chat-and-history/cb-103-host-owned-app-container-shell/technical-plan.md`

## Pencil Prerequisites

- Pencil docs synced locally: yes
- Pencil docs sync timestamp: `2026-03-31T20:01:12.060325+00:00`
- Synced docs pages reviewed:
  - `getting-started/ai-integration`
  - `design-and-code/design-to-code`
  - `for-developers/the-pen-format`
  - `for-developers/pencil-cli`
  - `core-concepts/components`
  - `core-concepts/slots`
  - `core-concepts/design-libraries`
  - `core-concepts/variables`
- `.pen` schema/layout guardrails reviewed: yes
- Pencil running: yes
- Pencil visible in `/mcp`: yes
- Pencil MCP treated as default bridge: yes
- Direct shell CLI used: no
- Design library file: `design/system/design-system.lib.pen`
- Story design file: `design/stories/CB-103.pen`
- Existing code imported first: no automated import; current renderer seams in `src/renderer/components/Artifact.tsx`, `src/renderer/components/chat/Message.tsx`, and `src/shared/types/session.ts` were reviewed directly and used as the baseline for the variations

## Foundation Reuse

- Design-system maturity: working
- Token source imported from code: existing Chatbox-aligned Pencil variables already present in the shared library copy
- Variables reused:
  - `color.fill.brand`
  - `color.surface`
  - `color.surface.selected`
  - `color.surface.success.soft`
  - `color.surface.warning.soft`
  - `color.text.primary`
  - `color.text.secondary`
  - `color.text.warning`
  - `space.*`
  - `radius.*`
  - `type.*`
- Components reused:
  - `ds_button_primary`
  - `ds_button_secondary`
  - `ds_badge`
  - `ds_action_chip`
  - `ds_section_card`
  - `ds_notice_banner`
  - `ds_resource_tile`
- Slots reused:
  - `section-card_content-slot`
- New foundation work added for this story:
  - story-specific host-shell compositions in `design/stories/CB-103.pen`
  - no new shared reusable component was added yet because the visual direction is still pending approval
- Missing foundation categories after this story:
  - dedicated shared components for app-state chips
  - reusable host-owned runtime shell primitives
  - reusable completion and fallback receipt variants
- Token sync back to code required: no, not at this review stage

## Variations

### Variation A
- Name: Inline shell with compact host rail
- Fidelity level: design-grade
- Summary: Keeps the app shell embedded inside the conversation card and puts the lifecycle strip directly above the viewport. This preserves the familiar inline message rhythm while still showing host-owned status and recovery actions.
- Tradeoffs: Best conversational fit, but the left host-state summary can become tight if we need richer audit detail or multi-step recovery guidance.
- Screenshot reference: `docs/specs/CHATBRIDGE-000-program-roadmap/pack-01-reliable-chat-and-history/cb-103-host-owned-app-container-shell/artifacts/pencil/dUTbu.png`

### Variation B
- Name: Split shell with persistent status rail
- Fidelity level: design-grade
- Summary: Separates the lifecycle rail from the live runtime stage. Readiness, fallback, and recovery context stay pinned on the left while the active app remains uninterrupted on the right.
- Tradeoffs: Strongest host-governance and debugging story, but less chat-native because the shell reads more like a managed tool panel than a conversational object.
- Screenshot reference: `docs/specs/CHATBRIDGE-000-program-roadmap/pack-01-reliable-chat-and-history/cb-103-host-owned-app-container-shell/artifacts/pencil/cQ9XM.png`

### Variation C
- Name: Conversation-aligned shell with inline fallback
- Fidelity level: design-grade
- Summary: Treats the shell as one stacked thread object: active runtime at the top and a single fallback receipt below it. This keeps the app feeling like part of the conversation without leaving a post-run summary artifact behind.
- Tradeoffs: Best narrative continuity and matches the request to avoid summary residue, but it leaves less room for durable completion metadata if later stories need an explicit end-state record in the thread.
- Screenshot reference: `docs/specs/CHATBRIDGE-000-program-roadmap/pack-01-reliable-chat-and-history/cb-103-host-owned-app-container-shell/artifacts/pencil/gD9Vd.png`

## Recommendation

- Recommended option: Variation C
- Why: It best matches the story’s primary user goal that embedded apps feel like part of the conversation, and the revised version now does that without leaving an unwanted summary receipt in the thread.

## User Feedback

- Feedback round 1: selected Variation C, requested removal of the summary receipt, keep the shell as active app plus inline fallback only
- Feedback round 2: pending

## Approval

- Selected option: Variation C
- Requested tweaks: remove the summary receipt; keep only the active app shell and inline fallback receipt
- Approval status: approved
- Approved on: 2026-03-31

## Implementation Notes

- Preferred implementation mode: manual
- Stack or library constraints to mention during export:
  - preserve existing Chatbox renderer patterns and state wiring
  - keep state logic separate from presentational shell code
  - do not couple the new shell to Chess-specific runtime assumptions
- Code surfaces that should follow the approved design:
  - `src/renderer/components/Artifact.tsx`
  - `src/renderer/components/chat/Message.tsx`
  - new `src/renderer/components/chatbridge/**`
  - `src/shared/types/session.ts`
- States or interactions to preserve:
  - `loading`
  - `ready`
  - `active`
  - `complete`
  - `error/fallback`
  - recovery and resume actions remain host-owned
- Accessibility notes to carry into implementation:
  - surfaced state labels must be readable by screen readers
  - recovery actions need clear button labels
  - completion and fallback receipts should remain visible in keyboard order
- Placeholder geometry still needing replacement before implementation:
  - active runtime canvases are representational, not final app chrome
  - receipt bodies need final copy once implementation data shapes are settled
