# CB-106 Pencil Review

## Metadata

- Story ID: CB-106
- Story Title: Floating ChatBridge runtime shell
- Author: Codex
- Date: 2026-04-02

## Spec References

- Design brief: `docs/specs/CHATBRIDGE-000-program-roadmap/pack-01-reliable-chat-and-history/cb-106-floating-chatbridge-runtime-shell/design-brief.md`
- Feature spec: `docs/specs/CHATBRIDGE-000-program-roadmap/pack-01-reliable-chat-and-history/cb-106-floating-chatbridge-runtime-shell/feature-spec.md`
- Technical plan: `docs/specs/CHATBRIDGE-000-program-roadmap/pack-01-reliable-chat-and-history/cb-106-floating-chatbridge-runtime-shell/technical-plan.md`

## Pencil Prerequisites

- Pencil docs sync attempted: yes
- Sync result: blocked in the clean worktree because
  `python3 .ai/scripts/sync_pencil_docs.py` fails with
  `ModuleNotFoundError: No module named 'bs4'`
- Fallback used: checked-in Pencil snapshot already under
  `.ai/reference/pencil/`
- Reviewed docs pages:
  - `getting-started/ai-integration`
  - `design-and-code/design-to-code`
  - `for-developers/the-pen-format`
  - `for-developers/pencil-cli`
  - `core-concepts/components`
  - `core-concepts/variables`
- `.pen` schema/layout guardrails reviewed: yes
- Pencil running: yes
- Pencil visible in `/mcp`: yes
- Design library file: `design/stories/CB-106.pen`
- Story design file: `design/stories/CB-106.pen`
- Existing code imported first: no automated import; the current renderer/session
  shell was reviewed directly from `src/renderer/routes/session/$sessionId.tsx`,
  `src/renderer/components/chatbridge/ChatBridgeShell.tsx`, and
  `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`

## Foundation Reuse

- Design-system maturity: working
- Variables reused:
  - `color.canvas`
  - `color.surface`
  - `color.surface.selected`
  - `color.surface.gray.soft`
  - `color.text.primary`
  - `color.text.secondary`
  - `color.border.default`
  - `color.border.brand`
  - `radius.*`
  - `space.*`
- Components reused:
  - `ds_badge`
  - `ds_action_chip`
  - `ds_button_primary`
  - `ds_button_secondary`
  - `ds_session_row`
  - `ds_session_row_selected`
- New foundation work added for this story:
  - story-only shell compositions for the three floating runtime directions
- Token sync back to code required: no, not at review stage

## Variations

### Variation A

- Name: Sticky dock
- Fidelity level: design-grade
- Copy fidelity: draft
- Summary:
  keeps the active app in a wide dock just above the composer while the thread
  remains fully readable above it
- Strengths:
  - best direct answer to the user request
  - keeps the live runtime close to the input area
  - preserves a compact in-thread anchor without making the thread feel empty
- Tradeoffs:
  - takes a consistent chunk of vertical space even when the app is not the only
    thing the user wants to focus on
- Screenshot reference:
  `docs/specs/CHATBRIDGE-000-program-roadmap/pack-01-reliable-chat-and-history/cb-106-floating-chatbridge-runtime-shell/artifacts/pencil/variation-a-sticky-dock.png`

### Variation B

- Name: Split tray
- Fidelity level: design-grade
- Copy fidelity: draft
- Summary:
  dedicates a full lower control rail to the app, with the thread above and a
  richer left-hand runtime control column
- Strengths:
  - strongest “serious app workspace” interpretation
  - gives the runtime more room and clearer status/control separation
  - good fit for denser apps like drawing or weather dashboards
- Tradeoffs:
  - least chat-native option
  - may feel heavy for lighter app interactions or shorter sessions
- Screenshot reference:
  `docs/specs/CHATBRIDGE-000-program-roadmap/pack-01-reliable-chat-and-history/cb-106-floating-chatbridge-runtime-shell/artifacts/pencil/variation-b-split-tray.png`

### Variation C

- Name: Focus bubble
- Fidelity level: design-grade
- Copy fidelity: draft
- Summary:
  reduces the floating runtime to a lighter bubble for desktop and explicitly
  pairs it with a mobile bottom-sheet interpretation
- Strengths:
  - lightest visual footprint
  - best for low-intensity apps that should remain glanceable rather than
    dominant
  - shows desktop and mobile behavior together
- Tradeoffs:
  - weaker for games or app states that need richer persistent controls
  - the bubble can feel less grounded as the canonical host shell
- Screenshot reference:
  `docs/specs/CHATBRIDGE-000-program-roadmap/pack-01-reliable-chat-and-history/cb-106-floating-chatbridge-runtime-shell/artifacts/pencil/variation-c-focus-bubble.png`

## Recommendation

- Recommended option: Variation A
- Why:
  it is the cleanest translation of “keep the app visible while I keep chatting”
  without turning ChatBridge into a full split-pane workstation. It preserves
  the conversation rhythm, makes the live runtime obvious, and should generalize
  well across Chess, Drawing Kit, and Weather.

## User Feedback

- Feedback round 1: user selected Variation B (`Split tray`)

## Approval

- Selected option: Variation B
- Requested tweaks: implement the split-tray session shell so the app stays visible while chat continues
- Approval status: approved

## Implementation Notes

- Preferred implementation mode: manual
- Stack or library constraints to mention during export:
  - route the floating host through the existing session route shell
  - preserve the message `app` part as the durable history record
  - reuse the existing overlay/focus patterns instead of inventing a new
    floating-window system
- Code surfaces that should follow the approved design:
  - `src/renderer/routes/session/$sessionId.tsx`
  - `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
  - `src/renderer/components/chatbridge/ChatBridgeShell.tsx`
  - `src/renderer/stores/uiStore.ts`
- States or interactions to preserve:
  - launching / ready / active visibility
  - minimize / restore
  - return to source message
  - degraded or stale fallback to the message anchor
