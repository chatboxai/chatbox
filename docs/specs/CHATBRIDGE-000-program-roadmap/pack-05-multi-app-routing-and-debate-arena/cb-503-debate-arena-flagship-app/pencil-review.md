# CB-503 Pencil Review

- Story ID: CB-503
- Story Title: Debate Arena flagship app
- Date: 2026-04-01
- Story file: `design/stories/CB-503.pen`

## Variations

### A. Coach-led column

- Node: `wzqka`
- Intent:
  Keep Debate Arena closest to the existing host-owned artifact language while
  still making setup, live round, and completion feel like one guided teaching
  sequence.
- Strengths:
  - Best continuity with the Pack 4 and CB-502 in-thread shell language
  - Setup, active round, and completion are easy to scan in order
  - Likely the least risky implementation against the current ChatBridge shell
- Risks:
  - More sequential than immersive
  - Slightly less distinct from other host-owned artifact states

### B. Round tracker board

- Node: `GPinZ`
- Intent:
  Make Debate Arena feel more like an active board with phase, timer, and
  result state visible at a glance.
- Strengths:
  - Strongest live-round telemetry
  - Best for users who want the app to feel competitive and active
  - Completion reads like a posted board update rather than a quiet wrap-up
- Risks:
  - More dashboard-like than conversational
  - Compact telemetry can feel denser in a narrow shell

### C. Classroom console

- Node: `MTYpt`
- Intent:
  Give the app a teacher-shaped moderation rail so the educational frame stays
  visible beside the live student flow.
- Strengths:
  - Best expression of classroom moderation and rubric-aware posture
  - Makes Debate Arena clearly distinct from Chess
  - Strongest fit if teacher guidance should be visible throughout the round
- Risks:
  - More system-like than the conversation-first options
  - Higher implementation complexity because the split emphasis is more
    opinionated

## Recommendation

Recommend **Variation A**.

Reasoning:

- It proves a second flagship workflow without forcing a new shell pattern.
- It stays closest to the host-owned artifact seams already validated in Pack 4
  and CB-502.
- It should be the fastest path to a polished, end-to-end Debate Arena slice
  that still feels educational rather than generic.

## Approval Gate

Implementation for CB-503 is blocked until one variation is explicitly
approved.
