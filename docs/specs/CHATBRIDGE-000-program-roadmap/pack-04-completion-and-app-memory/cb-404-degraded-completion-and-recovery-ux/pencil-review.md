# CB-404 Pencil Review

## Review Metadata

- Story ID: CB-404
- Story title: Degraded completion and recovery UX
- Pencil docs sync date: 2026-04-01
- Story design file: `design/stories/CB-404.pen`
- Variation node IDs:
  - A: `4Q4nx`
  - B: `KxrqY`
  - C: `ZIY8A`
- Approval state: pending user approval

## Review Goal

Compare three host-owned recovery patterns for missing, invalid, or interrupted
app completion. The chosen variation should keep the conversation usable, make
the next safe action obvious, and avoid generic error-chrome that looks
detached from the thread.

## Variation A: Inline rescue banner

- Dominant idea: the failure reason is explicit and visually primary.
- Structure:
  - shell summary card
  - inline warning banner
  - preserved-context note
  - immediate primary and secondary actions
- Strengths:
  - fastest to scan when the failure reason matters
  - strong action hierarchy
  - clearest option for auth/reconnect or partner-service failures
- Risks:
  - visually heavier than the other options
  - may over-emphasize the failure when the user mostly wants to continue the
    conversation

## Variation B: Guided recovery checklist

- Dominant idea: degraded completion becomes a controlled handoff.
- Structure:
  - shell summary card
  - checklist lead-in
  - three explicit recovery steps
  - two actions at the end
- Strengths:
  - best at reducing blind retry behavior
  - makes preserved context and next-step sequence explicit
  - good fit for multi-step auth, reconnection, or save/resume flows
- Risks:
  - tallest and densest option
  - slightly weaker emotional signal than Variation A if the system needs to
    communicate urgency

## Variation C: Conversation-first checkpoint

- Dominant idea: preserve thread continuity and keep the recovery shell calm.
- Structure:
  - initiating user goal capsule
  - inline checkpoint card
  - compact host-owned recovery explainer
  - follow-up and resume actions
- Strengths:
  - best continuity with the surrounding conversation
  - keeps the user goal visible
  - works well when the host can continue helping from preserved summary data
- Risks:
  - the failure condition is less visually prominent
  - weaker if the product needs a strong “you must reconnect first” signal

## Comparison Summary

| Variation | Best for | Tradeoff |
|---|---|---|
| A | explicit interruption and reconnect states | strongest warning tone |
| B | guided multi-step recovery | highest density |
| C | calm inline continuity and follow-up chat | softest failure signal |

## Current Recommendation

- Recommended starting point: Variation C
- Why:
  - It matches the Pack 4 goal of keeping degraded endings inside the thread
    without collapsing back to generic error UI.
  - It preserves the initiating user goal and makes “continue in chat” feel
    first-class instead of second-best.
  - It is the least likely to regress into a detached app-error panel once code
    lands.

## Approval Prompt

Choose one of:

- Approve A
- Approve B
- Approve C
- Request tweaks to A, B, or C

Implementation remains blocked until one variation is approved.
