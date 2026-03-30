# Pack 01 - Reliable Chat and History

> Summary mirror only. Use the canonical folder:
> `pack-01-reliable-chat-and-history/`

## Phase Fit

- Phase: 1 of 7
- Primary objectives: O1, O2
- Unlocks: app-capable timeline artifacts, host-owned embedded runtime shell,
  reliable persistence groundwork for all later app packs

## Pack Goal

Stabilize the current chat and message substrate so app-backed artifacts can
exist inside the thread without breaking session continuity, replay, export, or
future recovery behavior.

## Entry Gates

- Presearch and architecture are accepted as the source design direction.
- Existing session/message behavior is treated as the starting substrate, not
  as disposable legacy.

## Stories

### CB-101 Session durability baseline

- Goal:
  audit and harden current session and thread persistence for multi-part,
  app-aware conversations.
- Acceptance focus:
  existing sessions remain valid, thread continuity survives app-capable message
  parts, and export/format paths do not regress.
- Likely surfaces:
  `src/shared/types/session.ts`,
  `src/renderer/routes/session/$sessionId.tsx`,
  `src/renderer/lib/format-chat.tsx`,
  session storage and helpers.

### CB-102 App-capable message part schema

- Goal:
  extend the message model so the timeline can represent app launch, active
  state, completion, and recoverable failure as first-class artifacts.
- Acceptance focus:
  app artifacts are typed, serializable, backward-compatible, and renderable
  without overloading raw tool-call parts.
- Likely surfaces:
  `src/shared/types/session.ts`,
  `src/shared/utils/message.ts`,
  `src/renderer/components/chat/Message.tsx`.

### CB-103 Host-owned app container shell

- Goal:
  replace the "raw embedded artifact" mindset with a host-owned container that
  can later represent native apps, iframes, loading, and fallback states.
- Acceptance focus:
  host container states exist before any flagship app is built.
- Likely surfaces:
  `src/renderer/components/Artifact.tsx`,
  new `src/renderer/components/chatbridge/` surface,
  timeline message rendering.
- UI note:
  this is visible UI and will require a normal per-story Pencil pass before code.

### CB-104 App-aware persistence regression coverage

- Goal:
  add integration coverage for chat continuity, session reload, and future app
  artifact replay.
- Acceptance focus:
  app-aware message parts survive reload and do not break existing chat flows.
- Likely surfaces:
  `test/integration/`,
  `src/__tests__/`,
  session helper utilities.

## Exit Criteria

- App-capable timeline types exist on paper and in future implementation scope.
- The host has a clear embedded-container seam before partner app work starts.
- Persistence and export paths have an explicit regression plan.

## Risks

- Overloading tool-call parts instead of introducing explicit app artifacts
- Treating iframe display as enough without durability and recovery semantics
- Breaking existing session/thread export and formatting flows
