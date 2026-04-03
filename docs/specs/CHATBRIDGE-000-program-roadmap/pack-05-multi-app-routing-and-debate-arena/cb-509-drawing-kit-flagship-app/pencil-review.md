# Pencil Variation Review

## Metadata

- Story ID: CB-509
- Story Title: Drawing Kit flagship app
- Author: Codex
- Date: 2026-04-02

## Spec References

- Feature spec: `/private/tmp/chatbox-cb-509/docs/specs/CHATBRIDGE-000-program-roadmap/pack-05-multi-app-routing-and-debate-arena/cb-509-drawing-kit-flagship-app/feature-spec.md`
- Technical plan: `/private/tmp/chatbox-cb-509/docs/specs/CHATBRIDGE-000-program-roadmap/pack-05-multi-app-routing-and-debate-arena/cb-509-drawing-kit-flagship-app/technical-plan.md`
- Design brief: `/private/tmp/chatbox-cb-509/docs/specs/CHATBRIDGE-000-program-roadmap/pack-05-multi-app-routing-and-debate-arena/cb-509-drawing-kit-flagship-app/design-brief.md`

## Pencil Prerequisites

- Pencil docs synced locally: yes
- Pencil docs sync timestamp: `2026-04-02T23:18:43.741466+00:00`
- Synced docs pages reviewed: `/`, `/getting-started/ai-integration`, `/core-concepts/pen-files`, `/core-concepts/variables`, `/core-concepts/components`, `/core-concepts/slots`, `/core-concepts/design-libraries`, `/design-and-code/design-to-code`, `/troubleshooting`
- `.pen` schema/layout guardrails reviewed: yes
- Pencil running: yes
- Pencil visible in `/mcp`: yes
- Pencil MCP treated as default bridge: yes
- Direct shell CLI used: `open -a /Applications/Pencil.app /private/tmp/chatbox-cb-509/design/system/design-system.lib.pen`, `cp design/stories/CB-302.pen design/stories/CB-509.pen`
- Design library file: `/private/tmp/chatbox-cb-509/design/system/design-system.lib.pen`
- Story design file: `/private/tmp/chatbox-cb-509/design/stories/CB-509.pen`
- Existing code imported first: no; this review reused the checked-in design system and a copied story shell rather than importing live code into Pencil first

## Foundation Reuse

- Design-system maturity: working
- Token source imported from code: existing Chatbox/Pencil design-system library only
- Variables reused: base neutral surfaces, primary blue action accents, warning amber accents, body/caption typography from the existing library
- Components reused: buttons, chips, cards, shell/header frames, and lightweight status containers from the existing story/design-system setup
- Slots reused: action-chip label/icon slots and button label slots
- New foundation work added for this story: none
- Missing foundation categories after this story: no dedicated doodle-tool primitives yet; the approved implementation may want lightweight canvas-toolbar primitives in code, not necessarily new Pencil library components
- Token sync back to code required: no

## Variations

### Variation A

- Name: Sketch Tray
- Fidelity level: design-grade
- Brief interpretation: make Drawing Kit feel like a sticky-note doodle dare with a loud prompt, chunky tools, and a bankable sticker reward
- Copy fidelity: implementation-ready
- Summary: A warm, canvas-first game card with one absurd prompt in the center, a sticker-jackpot side note, a chunky tool row, and compact "bank this round" and handoff cards beneath the play area.
- Strengths: Strongest first-glance game feel; least like a productivity surface; best flagship energy; keeps the host checkpoint visible without stealing the round.
- Failure modes or misses against the brief: The side support cards are intentionally compressed, so implementation must keep checkpoint and replay behavior explicit enough to avoid reading as a throwaway toy.
- Screenshot reference: `/private/tmp/chatbox-cb-509/.ai/artifacts/cb-509-pencil-review-round-2/Vibhi.png`

### Variation B

- Name: Chaos Desk
- Fidelity level: design-grade
- Brief interpretation: stage the round like a messy tabletop with a score pile on the side and a host rail that banks the chaos
- Copy fidelity: implementation-ready
- Summary: A desk-chaos composition with the live page on the left and a score-pile rail on the right that banks the round result, replay path, and roast-ready follow-up summary.
- Strengths: Best balance of playful theme and explicit host truth; strongest replay explanation; the right rail now feels like game scorekeeping instead of enterprise state management.
- Failure modes or misses against the brief: Still the most structured option; if code adds too much chrome, it could drift back toward "tool with sidebar."
- Screenshot reference: `/private/tmp/chatbox-cb-509/.ai/artifacts/cb-509-pencil-review-round-2/5tSL1.png`

### Variation C

- Name: Snack Pack
- Fidelity level: design-grade
- Brief interpretation: make the app feel like a snack-size doodle mini-game with one tiny prompt and three little rewards orbiting the round
- Copy fidelity: implementation-ready
- Summary: A light, single-shell mini-game with a tiny prompt, pocket checkpoint, replay path, and a bottom trio of reward cards for recap, rematch, and recovery.
- Strengths: Most compact and consumer-like; strongest "quick round" framing; easiest path if the implementation should feel like a lightweight game inside chat rather than a featured tool.
- Failure modes or misses against the brief: Can undersell the flagship ambition if the code execution is too small or too static; needs a lively canvas treatment to avoid feeling merely cute.
- Screenshot reference: `/private/tmp/chatbox-cb-509/.ai/artifacts/cb-509-pencil-review-round-2/bjXHC.png`

## Recommendation

- Recommended option: Variation A, with selective naming and reward language from Variation C
- Why it best matches the design brief: After the user rejected the first round for still feeling too product-like, Variation A is the clearest correction. It reads immediately as a playable doodle dare, keeps the canvas central, and still proves banked checkpoint and replay truth without becoming a side-panel app.

## User Feedback

- Feedback round 1: User corrected the product direction from concept-map / diagram-builder energy toward a playful doodle-game posture.
- Feedback round 2: User rejected the first Pencil set and asked for a more game-first doodle direction instead of a polished app-shell treatment.

## Approval

- Approved design brief: `/private/tmp/chatbox-cb-509/docs/specs/CHATBRIDGE-000-program-roadmap/pack-05-multi-app-routing-and-debate-arena/cb-509-drawing-kit-flagship-app/design-brief.md`
- Selected option: Variation A - Sticker Sprint
- Requested tweaks: none
- Approval status: approved
- Approved on: `2026-04-02`

## Implementation Notes

- Preferred implementation mode: manual
- Stack or library constraints to mention during export: stay inside the existing ChatBridge reviewed-app shell, preserve host-owned checkpoint/resume semantics, and avoid introducing a detached canvas subsystem with separate persistence rules
- Code surfaces that should follow the approved design: `/private/tmp/chatbox-cb-509/src/renderer/components/chatbridge/apps/ReviewedAppLaunchSurface.tsx`, `/private/tmp/chatbox-cb-509/src/renderer/components/chatbridge/apps/surface.tsx`, `/private/tmp/chatbox-cb-509/src/renderer/packages/chatbridge/reviewed-app-launch.ts`, `/private/tmp/chatbox-cb-509/src/renderer/packages/chatbridge/bridge/reviewed-app-runtime.ts`, `/private/tmp/chatbox-cb-509/src/shared/chatbridge/reviewed-app-catalog.ts`
- States or interactions to preserve: blank round entry, active doodle round, save checkpoint, completion handoff, resume from checkpoint, and degraded-but-recoverable resume messaging
- Accessibility notes to carry into implementation: keyboard-reachable tools and CTAs, visible focus treatment, explicit status text for checkpoint/recovery/completion, and a non-pointer path for primary round actions
- Placeholder geometry still needing replacement before implementation: none in the selected Pencil review artboards
