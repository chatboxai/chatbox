# CB-302 Pencil Review

## Status

- Review state: approved
- Approved variation: A, with the 2026-03-31 spacing cleanup applied
- Blocking rule: implementation may proceed against approved Variation A
- Review date: 2026-03-31

## Variations

### Variation A: Board-first runtime

- Board is the primary surface inside the host-owned shell.
- Validation and host snapshot feedback sit directly below the board.
- Best fit for CB-302 scope because it keeps playability and host-state clarity without adding extra governance chrome.
- Revised on 2026-03-31 to correct spacing and minor overlap/clipping issues around the prompt block, board controls, and host-feedback note.

### Variation B: Split board and governance rail

- Board stays playable on the left while a persistent rail on the right carries legal-move diagnostics, move history, and reload continuity.
- Strongest explicit host-governance framing, but it starts to imply broader history and recovery scope than CB-302 strictly needs.

### Variation C: Conversation-first move deck

- Board remains central while a bottom deck carries move intent, host state, and legal-move readiness.
- Keeps the app visually closer to the surrounding thread, but the post-move/state surfaces become more secondary than in Variation B.

## Recommendation

- Recommended variation: A
- Rationale:
  - It satisfies the story acceptance criteria directly: playable board, clear legal/illegal feedback, and visible structured host sync.
  - It preserves the board as the flagship runtime proof without committing CB-302 to a larger side-rail or move-history product shape.
  - It keeps implementation risk lower for the first legal-move runtime while leaving room for richer governance surfaces in later Chess stories.

## Approval Prompt

- Approve Variation A, B, or C before implementation proceeds.
- If approved, the chosen variation becomes the UI source of truth for the runtime shell and move-feedback layout in this story.
