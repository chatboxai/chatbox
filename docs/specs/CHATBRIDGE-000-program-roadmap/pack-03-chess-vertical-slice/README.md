# Pack 03 - Chess Vertical Slice

## Phase Fit

- Phase: 3 of 7
- Primary objectives: O1, O2
- Unlocks: the first full in-thread app proof spanning launch, live state, assistant follow-up, and explicit completion

## Pack Goal

Use Chess as the first flagship app because it forces long-lived state, visible in-thread interaction, mid-game reasoning, and reliable completion behavior.

## Entry Gates

- Pack 02 contract, registry, and bridge decisions are accepted.
- The host container and app-aware message shape already exist or are ready to be implemented.

## Stories

- [CB-300 - Single-app tool discovery and invocation](./cb-300-single-app-tool-discovery-and-invocation/feature-spec.md)
- [CB-301 - In-thread app launch and rendering flow](./cb-301-in-thread-app-launch-and-rendering-flow/feature-spec.md)
- [CB-302 - Chess runtime and legal move engine](./cb-302-chess-runtime-and-legal-move-engine/feature-spec.md)
- [CB-303 - Mid-game assistant reasoning with live board context](./cb-303-mid-game-assistant-reasoning-with-live-board-context/feature-spec.md)
- [CB-304 - Completion, resume, and end-of-game summary](./cb-304-completion-resume-and-end-of-game-summary/feature-spec.md)

## Exit Criteria

- A single approved app can be discovered and invoked before deeper UI work.
- Chess can launch from chat and stay coherent in-thread.
- The assistant can reason over current board state mid-game.
- Completion and resume semantics are explicit rather than implied.

## Risks

- Polishing the board UI before host lifecycle rules are proven.
- Letting Chess bypass the general platform contract because it is the first flagship app.
- Treating board rendering as success without follow-up context continuity.
