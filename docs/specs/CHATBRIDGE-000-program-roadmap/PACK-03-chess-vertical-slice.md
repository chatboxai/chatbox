# Pack 03 - Chess Vertical Slice

> Summary mirror only. Use the canonical folder:
> `pack-03-chess-vertical-slice/`

## Phase Fit

- Phase: 3 of 7
- Primary objectives: O1, O2
- Unlocks: first full proof that the host/runtime contract can support a real
  in-thread app experience

## Pack Goal

Use Chess as the first fully integrated flagship app because it forces
long-lived state, visible in-thread interaction, mid-session follow-up
reasoning, and explicit end-of-game completion.

## Entry Gates

- Pack 02 contract, registry, and bridge work is accepted.
- The host can represent an app lifecycle before the first real app arrives.

## Stories

### CB-300 Single-app tool discovery and invocation

- Goal:
  prove the assistant can discover and invoke a single reviewed app's tools
  through the host contract before deeper UI integration begins.
- Acceptance focus:
  one approved app can be selected, invoked, and observed without yet relying
  on multi-app routing breadth.
- Likely surfaces:
  app selection/orchestration seams,
  manifest/tool contract adapters,
  host execution coordination and integration tests.

### CB-301 In-thread app launch and rendering flow

- Goal:
  open Chess from a natural-language request and render it inside the chat
  timeline through the host-owned app container.
- Acceptance focus:
  the chat route, timeline, and active-session shell can activate a real app.
- Likely surfaces:
  `src/renderer/routes/session/$sessionId.tsx`,
  `src/renderer/components/chat/Message.tsx`,
  new `src/renderer/components/chatbridge/`.
- UI note:
  visible UI story; route through Pencil before code.

### CB-302 Chess runtime and legal move engine

- Goal:
  deliver the actual chess app experience with board state, move validation, and
  user interaction.
- Acceptance focus:
  invalid moves fail safely, board state stays coherent, and the app can emit
  state updates to the host.
- Likely surfaces:
  new `src/renderer/components/chatbridge/apps/chess/`,
  bridge event adapters,
  mock-app test fixtures.
- UI note:
  visible UI story; route through Pencil before code.

### CB-303 Mid-game assistant reasoning with live board context

- Goal:
  allow the user to ask follow-up questions mid-game and have the assistant
  answer from the current board state.
- Acceptance focus:
  current app summary/state reaches the orchestrator cleanly without exposing
  raw untrusted app internals.
- Likely surfaces:
  model-call orchestration,
  host runtime state selectors,
  message context assembly.

### CB-304 Completion, resume, and end-of-game summary

- Goal:
  support completion signaling, result summarization, and session resume after
  pause or reload.
- Acceptance focus:
  the conversation can discuss the game after the board is gone or inactive.
- Likely surfaces:
  app instance store,
  event persistence,
  future `summaryForModel` normalization seam.

## Exit Criteria

- A single approved app can be discovered and invoked before deeper UI work.
- Chess can launch from chat, stay coherent, and return structured outcomes.
- Mid-game follow-up proves the host can mix conversation and app state.
- End-of-game completion is explicit rather than inferred.

## Risks

- Shipping a polished board before the host can explain or recover its state
- Letting Chess bypass host lifecycle rules because it is the first-party app
- Treating "it renders" as success when mid-game context and completion are weak
