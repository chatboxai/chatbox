# CB-502 Pencil Review

- Story ID: CB-502
- Story Title: Route, clarify, or refuse decision path
- Date: 2026-04-01
- Pencil docs sync: `python3 .ai/scripts/sync_pencil_docs.py` run on 2026-04-01
- Story file: `design/stories/CB-502.pen`

## Variations

### A. Guided chooser

- Node: `ZaHfC`
- Intent:
  Keep both clarify and chat-only outcomes inside the same quiet section-card
  language used elsewhere in the host shell.
- Strengths:
  - Very explicit app choices
  - Feels safe and deliberate
  - Easy to extend with more debug copy
- Risks:
  - Reads more like a mini control panel than a normal assistant reply
  - The clarify state may feel slightly heavy if it appears often

### B. Banner-first guidance

- Node: `W7k2D`
- Intent:
  Surface the routing decision as a trust-oriented banner first, then make the
  user choose whether to launch or stay in chat.
- Strengths:
  - Highest visibility for safety/trust framing
  - Clarify and refusal are immediately scannable
  - Strongest “host intervened intentionally” signal
- Risks:
  - More system-like and less conversational
  - Banner treatment may feel too assertive for ordinary ambiguity

### C. Conversation-first artifacts

- Node: `Gc6Oh`
- Intent:
  Keep both clarify and refusal states visually close to a normal assistant
  artifact, with host-owned action choices embedded in-thread.
- Strengths:
  - Best continuity with Pack 4’s host-owned recovery surfaces
  - Clarify state still feels decisive without reading like an alert
  - Refusal state feels like a calm assistant judgment, not a warning
- Risks:
  - Slightly less forceful than a banner when strong intervention is needed
  - Requires careful copy so “stay in chat” does not feel secondary

## Recommendation

Recommend **Variation C**.

Reasoning:

- It preserves the in-thread, host-owned artifact language established in
  Pack 4 instead of introducing a louder warning surface by default.
- It makes clarify and refusal feel like understandable conversation states,
  not policy interrupts.
- It should translate cleanly into the existing ChatBridge shell and message
  timeline with the least visual drift.

## Approval Gate

Implementation for CB-502 is blocked until one variation is explicitly
approved.
