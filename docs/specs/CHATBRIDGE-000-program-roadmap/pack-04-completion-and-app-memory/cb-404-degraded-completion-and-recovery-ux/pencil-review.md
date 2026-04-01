# Pencil Variation Review

## Metadata

- Story ID: CB-404
- Story Title: Degraded completion and recovery UX
- Author: Codex
- Date: 2026-04-01

## Spec References

- Feature spec: `docs/specs/CHATBRIDGE-000-program-roadmap/pack-04-completion-and-app-memory/cb-404-degraded-completion-and-recovery-ux/feature-spec.md`
- Technical plan: `docs/specs/CHATBRIDGE-000-program-roadmap/pack-04-completion-and-app-memory/cb-404-degraded-completion-and-recovery-ux/technical-plan.md`

## Pencil Prerequisites

- Pencil docs synced locally: yes
- Pencil docs sync timestamp: 2026-04-01T19:29:35Z
- Synced docs pages reviewed:
  - AI Integration
  - Design ↔ Code
  - The .pen Format
  - Pencil CLI
  - Design Libraries
  - Components
  - Slots
  - Variables
- `.pen` schema/layout guardrails reviewed: yes
- Pencil running: yes
- Pencil visible in `/mcp`: yes
- Pencil MCP treated as default bridge: yes
- Direct shell CLI used: no
- Design library file: `design/system/design-system.lib.pen`
- Story design file: `design/stories/CB-404.pen`
- Existing code imported first: no; existing renderer code and prior ChatBridge shell work were used as the behavioral baseline, and the checked-in design library was reused for composition

## Foundation Reuse

- Design-system maturity: working
- Token source imported from code: existing checked-in Pencil variables only
- Variables reused:
  - `color.text.*`
  - `color.surface.*`
  - `color.border.*`
  - `space.*`
  - `radius.*`
- Components reused:
  - `ds_page_shell`
  - `ds_page_header`
  - `ds_toolbar_shell`
  - `ds_notice_banner`
  - `ds_section_card`
  - `ds_split_pane_shell`
  - `ds_two_column_shell`
  - `ds_badge`
  - `ds_action_chip`
  - `ds_button_primary`
  - `ds_button_secondary`
- Slots reused:
  - `page-shell_header-slot`
  - `page-shell_content-slot`
  - `toolbar-shell_left-slot`
  - `toolbar-shell_center-slot`
  - `toolbar-shell_right-slot`
  - `section-card_content-slot`
  - `split-pane_sidebar-slot`
  - `split-pane_content-slot`
  - `two-column_left-slot`
  - `two-column_right-slot`
- New foundation work added for this story: none
- Missing foundation categories after this story:
  - dedicated chat-thread shell component in Pencil
  - smaller incident/status card primitive for dense inline recovery states
- Token sync back to code required: no

## Variations

### Variation A

- Name: Recovery Control Deck
- Fidelity level: design-grade
- Summary:
  - One dominant degraded-completion banner explains the failure in plain language.
  - Recovery actions are grouped into a compact two-card deck beneath the alert.
  - Best fit when the product wants one obvious “what happened / what now” decision surface.
- Tradeoffs:
  - Strong action emphasis, but the state-summary cards get dense quickly.
  - Feels slightly more like a control center than a natural chat-thread continuation.
- Screenshot reference: `docs/specs/CHATBRIDGE-000-program-roadmap/pack-04-completion-and-app-memory/cb-404-degraded-completion-and-recovery-ux/artifacts/pencil/BgSQs.png`

### Variation B

- Name: Explicit State Ladder
- Fidelity level: design-grade
- Summary:
  - Stacks degraded endings as clearly separated states: partial, missing, and invalid.
  - Each card carries a bounded follow-up action so the host never leaves the user guessing.
  - Best fit when clarity of taxonomy and inspectability matter most.
- Tradeoffs:
  - Excellent for review and debugging, but heavier than the real runtime may need if only one degraded state appears at a time.
  - More product-admin in tone than conversation-native.
- Screenshot reference: `docs/specs/CHATBRIDGE-000-program-roadmap/pack-04-completion-and-app-memory/cb-404-degraded-completion-and-recovery-ux/artifacts/pencil/STHlc.png`

### Variation C

- Name: Conversation-First Recovery Rail
- Fidelity level: design-grade
- Summary:
  - Keeps one dominant inline recovery surface in the message area.
  - Moves trust, memory-bounding, and quarantine details into a narrow host rail.
  - Best fit when degraded endings should still feel like part of the conversation rather than a status console.
- Tradeoffs:
  - The state taxonomy is less exhaustive at a glance than Variation B.
  - Relies on the support rail for some of the deeper operational context.
- Screenshot reference: `docs/specs/CHATBRIDGE-000-program-roadmap/pack-04-completion-and-app-memory/cb-404-degraded-completion-and-recovery-ux/artifacts/pencil/ACBjW.png`

## Recommendation

- Recommended option: C
- Why:
  - It best preserves the approved ChatBridge direction from earlier stories: host-owned UI that still feels part of the thread.
  - It gives CB-404 a clear main recovery explanation plus a bounded host rail for memory/trust details, without turning the message into a control dashboard.
  - It is the easiest variation to translate into the existing `ChatBridgeShell` seam without inventing a completely new renderer pattern.

## User Feedback

- Feedback round 1: user approved the recommended direction by saying `go with your recommendation`
- Feedback round 2: not needed

## Approval

- Selected option: C
- Requested tweaks: none
- Approval status: approved
- Approved on: 2026-04-01

## Implementation Notes

- Preferred implementation mode: manual
- Stack or library constraints to mention during export:
  - preserve Mantine + existing ChatBridge shell conventions
  - keep recovery actions and copy host-owned
  - do not reintroduce detached completion receipts
- Code surfaces that should follow the approved design:
  - `src/renderer/components/chatbridge/ChatBridgeShell.tsx`
  - `src/renderer/components/chatbridge/chatbridge.ts`
  - `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
  - `src/shared/chatbridge/live-seeds.ts`
  - `src/shared/chatbridge/degraded-completion.ts`
- States or interactions to preserve:
  - partial completion
  - missing completion
  - invalid completion
  - continue in chat
  - retry completion
  - bounded fallback / last validated checkpoint language
- Accessibility notes to carry into implementation:
  - degraded state must be readable without icon dependence
  - action hierarchy should remain obvious in keyboard order
  - status copy must stay plain-language and screen-reader friendly
- Placeholder geometry still needing replacement before implementation:
  - none in the approved review options; the remaining work is code translation and state wiring
