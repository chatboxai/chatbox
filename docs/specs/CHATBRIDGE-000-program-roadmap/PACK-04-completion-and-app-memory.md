# Pack 04 - Completion and App Memory

> Summary mirror only. Use the canonical folder:
> `pack-04-completion-and-app-memory/`

## Phase Fit

- Phase: 4 of 7
- Primary objectives: O1, O2, O3
- Unlocks: durable post-app conversation continuity, normalized model memory,
  reliable degraded-state recovery

## Pack Goal

Turn completion signaling and app-aware memory into first-class host behavior so
later app breadth does not rest on vague or app-authored summaries.

## Entry Gates

- Chess proves a real app lifecycle exists.
- The team has at least one real completion shape to normalize against.

## Stories

### CB-401 Structured completion payload contract

- Goal:
  define the canonical shape for app completion, result metadata, resumability,
  and suggested summaries.
- Acceptance focus:
  apps submit structured outcomes instead of freeform prose blobs.
- Likely surfaces:
  new `src/shared/chatbridge/completion.ts`,
  instance/event schemas,
  validation tests.

### CB-402 Host summary normalization pipeline

- Goal:
  validate, redact, and normalize app outcomes into a safe host-owned
  `summaryForModel`.
- Acceptance focus:
  apps never write directly into model memory.
- Likely surfaces:
  host runtime,
  context-management packages,
  summary utilities.

### CB-403 Active app context injection for later turns

- Goal:
  make follow-up chat turns aware of the current or most recent app state in a
  controlled way.
- Acceptance focus:
  advice and discussion can continue after app interactions without raw partner
  context leakage.
- Likely surfaces:
  `src/renderer/packages/context-management/`,
  model message conversion,
  session helpers.

### CB-404 Degraded completion and recovery UX

- Goal:
  handle missing completion payloads, interrupted sessions, and stale active app
  pointers as recoverable host states.
- Acceptance focus:
  the chat remains usable even when an app fails to finish cleanly.
- Likely surfaces:
  host runtime state,
  timeline rendering,
  app container fallback surfaces.
- UI note:
  visible UI story; route through Pencil before code.

## Exit Criteria

- Completion is an explicit protocol event with a reviewed payload contract.
- Model-visible memory becomes host-normalized rather than app-authored.
- The conversation can survive interrupted or degraded app endings.

## Risks

- Treating app completion as optional metadata instead of a required host event
- Allowing partner summaries to bypass host validation and redaction
- Ignoring degraded states until multi-app scale makes them hard to reason about
