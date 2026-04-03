# I001-02 Technical Plan

## Metadata

- Story ID: I001-02
- Story Title: ChatBridge tray renderable-surface gating
- Author: Codex
- Date: 2026-04-02

## Proposed Design

- Components/modules affected:
  - `src/renderer/components/chatbridge/apps/surface.tsx`
  - `src/renderer/components/chatbridge/floating-runtime.ts`
  - `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
  - `src/renderer/components/chatbridge/FloatingChatBridgeRuntimeShell.tsx`
  - `src/renderer/components/chat/Message.tsx`
  - `src/renderer/routes/session/$sessionId.tsx`
  - `src/renderer/components/chatbridge/*.test.tsx`
  - ChatBridge seed and lab surfaces if the final implementation changes the
    seeded presentation contract
- Public interfaces/contracts:
  - a pure renderer-side ChatBridge surface classification helper
  - a shared tray-eligibility rule derived from that classification
  - message presentation rules for `inline` versus `anchor`
- Data flow summary:
  message app part -> surface classification decides whether the part is
  tray-eligible -> session route promotes only tray-eligible parts into the
  floating shell -> message list uses the same classification to decide whether
  anchor mode is allowed -> non-surface artifacts remain inline with their
  existing artifact UI.

## Architecture Decisions

- Decision:
  introduce one explicit surface-classification seam instead of letting tray
  code infer eligibility from lifecycle alone.
- Decision:
  keep the contract renderer-local and presentation-focused. The story should
  not reshape route-decision or launch persistence models.
- Decision:
  treat route artifacts as inline-only surfaces even though they are stored as
  `app` parts, because their UX contract is timeline explanation rather than
  docked app control.

## Data Model / API Contracts

- Proposed helper contract:
  a pure helper should classify a `MessageAppPart` into a small set such as
  `tray-eligible-surface`, `inline-artifact`, or `none`.
- Callers that should consume the helper:
  - `resolveChatBridgeFloatingRuntimeTarget(...)`
  - anchor-presentation selection in `Message.tsx` or a companion helper
  - `ChatBridgeMessagePart` when deciding whether tray copy and affordances are
    valid for the part
- Persisted schema changes:
  none; the story is about presentation truth, not storage.

## Dependency Plan

- Existing dependencies used:
  current ChatBridge surface resolver, route-decision helpers, message
  presentation wiring, and focused component tests
- New dependencies proposed:
  none
- Risk and mitigation:
  avoid making the classification helper depend on React node inspection; keep
  it pure so tests can prove the contract directly.

## Test Strategy

- Unit tests:
  - tray target resolution skips route artifacts and other non-surface parts
  - the shared helper marks reviewed launches and real runtime surfaces as
    tray-eligible
  - stale or malformed records fail closed
- Component tests:
  - route artifacts remain inline and never receive anchor-specific affordances
  - tray shell still renders for a known real runtime
- Manual or seeded verification:
  validate a thread with a real runtime plus a later chat-only route receipt so
  the tray stays tied to the true runtime and the receipt stays inline

## UI Implementation Plan

- Behavior layer:
  add the shared surface classification and reuse it for tray/anchor gating
- Visible shell changes:
  suppress tray-only instructional copy and actions when no tray exists
- Scope guard:
  keep existing inline route-artifact composition unless the chosen design
  decision calls for a minimal copy trim that is required to remove duplicated
  noise

## Rollout and Risk Mitigation

- Rollback strategy:
  the implementation should be localized enough that reverting the shared
  classification helper and its callers restores the prior tray behavior
- Feature flags/toggles:
  none by default
- Observability checks:
  no new trace contract is required for the planning slice; rely on focused
  tests and seeded/manual verification unless the implementation expands beyond
  renderer presentation

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
