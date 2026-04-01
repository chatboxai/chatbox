# CB-302 Pencil Review

## Metadata

- Story ID: CB-302
- Story Title: Chess runtime and legal move engine
- Author: Codex
- Date: 2026-03-31

## Spec References

- Feature spec: `docs/specs/CHATBRIDGE-000-program-roadmap/pack-03-chess-vertical-slice/cb-302-chess-runtime-and-legal-move-engine/feature-spec.md`
- Technical plan: `docs/specs/CHATBRIDGE-000-program-roadmap/pack-03-chess-vertical-slice/cb-302-chess-runtime-and-legal-move-engine/technical-plan.md`

## Pencil Prerequisites

- Pencil docs synced locally: yes
- Pencil docs sync timestamp: `2026-03-31T22:37:58.517110+00:00`
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
- Story design file: `design/stories/CB-302.pen`
- Existing code imported first: no automated import; the current renderer, session-store, live-seed, and shared ChatBridge seams were reviewed directly and used as the source-of-truth for the variations

## Foundation Reuse

- Design-system maturity: working
- Token source imported from code: existing Chatbox-aligned Pencil variables already present in the shared library copy
- Variables reused:
  - `color.fill.brand`
  - `color.surface`
  - `color.surface.selected`
  - `color.surface.gray.soft`
  - `color.canvas`
  - `color.text.primary`
  - `color.text.secondary`
  - `color.text.tertiary`
  - `color.text.brand`
  - `color.text.inverse`
  - `color.border.default`
  - `radius.*`
  - `type.*`
  - `space.*`
- Components reused:
  - `ds_badge`
  - `ds_action_chip`
  - `ds_button_primary`
  - `ds_button_secondary`
- Slots reused:
  - none directly; the story uses the library components and token system, then composes story-local runtime shells manually
- New foundation work added for this story:
  - story-local reusable chess board primitives in `design/stories/CB-302.pen`
  - story-local board state mock with contrasting white/black piece tokens
  - three story-local runtime shell layouts for board-first, split-rail, and move-deck interpretations
- Missing foundation categories after this review:
  - shared chess-specific runtime shell primitive
  - shared inline move deck pattern for hosted app states
  - shared host-owned rejection banner pattern for app runtimes
- Token sync back to code required: no, not at the review stage

## Variations

### Variation A
- Name: Board-first runtime
- Fidelity level: design-grade
- Summary: The board is the main event. Validation and host sync sit below the board in one wide follow-through card so the thread feels immediately playable, and the revised board mock now uses real chess-piece glyphs instead of letter placeholders.
- Tradeoffs: Fastest path to "I asked for chess and now I can play," but illegal-move details and reload context are less persistent than in the rail option.
- Screenshot reference: `docs/specs/CHATBRIDGE-000-program-roadmap/pack-03-chess-vertical-slice/cb-302-chess-runtime-and-legal-move-engine/artifacts/pencil/N4aYe.png`

### Variation B
- Name: Split board + governance rail
- Fidelity level: design-grade
- Summary: The board remains playable, while a permanent right rail owns illegal-move messaging, move history, and reload continuity.
- Tradeoffs: Strongest observability and governance story, but it gives up some board prominence and reads a little more like a tool surface than a natural chat continuation.
- Screenshot reference: `docs/specs/CHATBRIDGE-000-program-roadmap/pack-03-chess-vertical-slice/cb-302-chess-runtime-and-legal-move-engine/artifacts/pencil/H9iBF.png`

### Variation C
- Name: Conversation-first move deck
- Fidelity level: design-grade
- Summary: The board stays inline in the assistant block, and move validation plus host-state context live in a bottom deck directly beneath the board.
- Tradeoffs: Best continuity with the existing conversation-first shell direction and the cleanest in-thread story for accepted or rejected moves, but it exposes less persistent state at once than the rail option.
- Screenshot reference: `docs/specs/CHATBRIDGE-000-program-roadmap/pack-03-chess-vertical-slice/cb-302-chess-runtime-and-legal-move-engine/artifacts/pencil/us3AT.png`

## Recommendation

- Recommended option at review time: Variation C
- Why: It preserved the approved conversation-first ChatBridge direction, kept the playable board central, and still gave the story a clear place for legal or illegal move feedback plus reload continuity without creating a second persistent control surface next to the board.

## User Feedback

- Feedback round 1: user prefers Variation A, but requested actual chess pieces instead of letter tokens; Variation A was revised in-place to use supported chess-piece glyphs and needs final approval on the updated screenshot
- Feedback round 2: user approved the revised Variation A after the board mock switched to real chess-piece glyphs

## Approval

- Selected option: Variation A
- Requested tweaks: replace letter placeholders on the board with actual chess pieces
- Approval status: approved
- Approved on: 2026-03-31

## Implementation Notes

- Preferred implementation mode: manual
- Stack or library constraints to mention during export:
  - preserve the current host-owned ChatBridge shell and message timeline seams
  - keep chess legality and board-state logic outside presentational components
  - wire the runtime through host-owned structured state instead of local-only UI mutations
- Code surfaces that should follow the approved design:
  - `src/renderer/components/chatbridge/apps/chess/**`
  - `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
  - `src/renderer/components/chatbridge/ChatBridgeShell.tsx`
  - `src/renderer/components/chat/Message.tsx`
  - `src/shared/types/session.ts`
  - `src/shared/chatbridge/**`
  - `src/renderer/packages/chatbridge/**`
  - live seed surfaces under `src/shared/chatbridge/live-seeds.ts`, `src/renderer/dev/chatbridgeSeeds.ts`, and `src/renderer/components/dev/ChatBridgeSeedLab.tsx`
- States or interactions to preserve:
  - ready board render inside the host shell
  - legal move acceptance
  - illegal move rejection with clear reason
  - structured host-state emission after accepted moves
  - session reload continuity for the current position
  - stale or degraded fallback behavior inside the same conversational block
- Accessibility notes to carry into implementation:
  - board squares and pieces need explicit keyboard and screen-reader semantics
  - the surfaced move result must be announced clearly when a move is accepted or rejected
  - reload continuity and host-state messaging should remain readable in logical DOM order beneath the board
- Placeholder geometry still needing replacement before implementation:
  - the board is representational and must become the real interactive chess runtime
  - the reviewed board now uses chess-piece glyphs, but the final runtime still needs production-rendered interactive pieces rather than static design tokens
  - move history and validation copy need to bind to the real chess state contract once the runtime exists
