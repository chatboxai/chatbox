# I001-02 Constitution Check

## Story Context

- Story ID: I001-02
- Story Title: ChatBridge tray renderable-surface gating
- Initiative: CHATBRIDGE-001 Post-rebuild agent productization
- Owner: Codex
- Date: 2026-04-02

## Constraints

1. Start the work on a fresh `codex/` branch/worktree and keep the root dirty
   tree untouched.
   Sources:
   `AGENTS.md`, `.ai/codex.md`
2. Treat this as a standard-lane story with the checked-in spec packet under
   `docs/specs/<story-id>/`.
   Sources:
   `.ai/workflows/story-sizing.md`,
   `.ai/skills/spec-driven-development.md`
3. Because the story changes visible ChatBridge shell behavior, record the
   design brief, design research, and design decision before implementation.
   Sources:
   `AGENTS.md`,
   `.ai/workflows/autonomous-ui-design.md`,
   `.ai/docs/UI_DESIGN_WORKFLOW.md`
4. Keep the correction narrow: remove phantom tray and anchor behavior without
   silently redesigning the broader ChatBridge shell system.
   Source:
   `AGENTS.md`
5. If the implementation changes inspectable ChatBridge shell or lifecycle
   behavior, refresh the live seeds, dev seeds, preset sessions, and lab
   coverage in the final implementation story.
   Sources:
   `AGENTS.md`,
   `.ai/codex.md`
6. Preserve the repo validation baseline and default fork-targeted GitHub flow
   when the eventual implementation story lands.
   Sources:
   `AGENTS.md`,
   `package.json`

## Structural Map

- Session-level float target selection:
  `src/renderer/components/chatbridge/floating-runtime.ts`
- Session route that mounts the floating tray:
  `src/renderer/routes/session/$sessionId.tsx`
- Message-level inline versus anchor presentation:
  `src/renderer/components/chat/Message.tsx`
- ChatBridge app-part presentation shell:
  `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
- Floating tray chrome:
  `src/renderer/components/chatbridge/FloatingChatBridgeRuntimeShell.tsx`
- Renderable app-surface resolver:
  `src/renderer/components/chatbridge/apps/surface.tsx`
- Route-artifact message-part creation:
  `src/shared/chatbridge/routing.ts`
- Existing focused tests:
  `src/renderer/components/chatbridge/floating-runtime.test.ts`
  `src/renderer/components/chatbridge/FloatingChatBridgeRuntimeShell.test.tsx`
  `src/renderer/components/chatbridge/ChatBridgeMessagePart.test.tsx`

## Exemplars

1. `src/renderer/components/chatbridge/apps/surface.tsx`
   Current source of truth for which app parts actually produce a visible
   surface.
2. `src/renderer/components/chatbridge/floating-runtime.ts`
   Current tray-promotion rule that drifts from the real surface resolver.
3. `docs/specs/CHATBRIDGE-000-program-roadmap/pack-01-reliable-chat-and-history/cb-106-floating-chatbridge-runtime-shell/feature-spec.md`
   Original tray contract and explicit fail-closed edge-case intent.
4. `docs/specs/CHATBRIDGE-000-program-roadmap/pack-05-multi-app-routing-and-debate-arena/cb-507-live-route-clarify-refuse-artifacts-and-actions/feature-spec.md`
   Route artifacts are designed as inline timeline artifacts, not docked app
   runtimes.

## Lane Decision

- Lane: `standard`
- Why:
  the bug spans shared presentation rules across session routing, message
  rendering, and visible shell chrome; it is not a one-file copy tweak.
- Required gates:
  four-artifact story packet, UI design artifacts, focused tests, full repo
  validation for the eventual implementation story
- Explicitly skipped here:
  trace-driven development is not required for this planning packet because
  the intended implementation is renderer-local presentation gating. If the
  implementation expands into runtime orchestration or cross-process lifecycle
  changes, that gate must be reintroduced.

## Outcome Notes

- The core defect is a contract mismatch: floatability is inferred from generic
  lifecycle state, while actual surface availability is decided elsewhere.
- The implementation story should introduce one shared tray-eligibility rule so
  route receipts, chat-only artifacts, and any future non-surface app parts do
  not reopen this drift.
