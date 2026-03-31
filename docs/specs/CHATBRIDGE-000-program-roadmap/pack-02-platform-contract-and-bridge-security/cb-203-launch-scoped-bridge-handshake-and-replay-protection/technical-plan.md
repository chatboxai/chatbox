# CB-203 Technical Plan

## Metadata

- Story ID: CB-203
- Story Title: Launch-scoped bridge handshake and replay protection
- Author: Codex
- Date: 2026-03-30

## Proposed Design

- Components/modules affected:
- `src/shared/chatbridge/`
- `src/renderer/packages/chatbridge/bridge/`
- `src/renderer/components/Artifact.tsx`
- `src/renderer/components/chatbridge/chatbridge.ts`
- Public interfaces/contracts:
- bridgeSession bootstrap envelope
- Dedicated channel/message-port binding semantics
- Sequence number and idempotency validation rules
- Data flow summary:
  Host artifact shell creates appInstance -> mints launch-scoped bridgeSession -> bootstraps a local artifact runtime with a signed envelope and transferred `MessagePort` -> runtime acks -> host validates later state/error/complete events against the active session.

## Architecture Decisions

- Decision:
  Adopt a launch-scoped, bound-channel bridge session on the existing artifact preview seam rather than ambient cross-window messaging.
- Alternatives considered:
- Origin checks only
- Keep the remote artifact preview page and continue sending HTML over wildcard `postMessage`
- Introduce a speculative `src/main/chatbridge/` runtime before any checked-in runtime consumer exists
- Rationale:
  The trust boundary is session-specific, not just origin-specific, and the current artifact iframe is the only real bridge consumer on `main`, so hardening that path is the smallest defensible implementation.

## Data Model / API Contracts

- Request shape:
  Inputs should follow the contracts above and be validated before any host-side state transition.
- Response shape:
  Outputs should be normalized into host-owned records or timeline artifacts rather than ad hoc partner payloads.
- Storage/index changes:
  This story should update only the specific host/session/runtime records it needs and keep the broader ChatBridge model forward-compatible.

## Dependency Plan

- Existing dependencies used:
  current Chatbox renderer/timeline patterns, host-shell seams, and Zod-based shared contracts
- New dependencies proposed (if any):
  none by default; prefer existing stack and utilities unless implementation proves a real gap
- Risk and mitigation:
  keep the work inside the existing artifact seam, add targeted bridge tests before wiring the iframe, and fall back to `*` only for bootstrap delivery when the renderer origin is opaque

## Test Strategy

- Unit tests:
- Shared bridge-session contract parsing
- Handshake success and failure paths
- Replay/duplicate event rejection behavior
- Artifact runtime markup smoke coverage
- Integration tests:
  cover the full host/runtime path with a mock partner runtime and transferred message-port simulation
- E2E or smoke tests:
  add a focused smoke path if the story changes user-visible app flow or session continuity
- Edge-case coverage mapping:
  stale state, malformed inputs, and degraded fallback behavior should be covered explicitly

## UI Implementation Plan

- Behavior logic modules:
  host/runtime/state rules should live outside presentational UI components
- Component structure:
  preserve the approved host-owned shell from CB-103 and change only the runtime bridge beneath it
- Accessibility implementation plan:
  define keyboard behavior, roles, labels, and readable status/error states for any surfaced UI
- Visual regression capture plan:
  no new visible surface was added; inspect the existing HTML artifact preview flow and fallback shell instead

## Implementation Evidence

- Shared contract and validation:
  - `src/shared/chatbridge/bridge-session.ts`
- Host/runtime bridge modules:
  - `src/renderer/packages/chatbridge/bridge/host-controller.ts`
  - `src/renderer/packages/chatbridge/bridge/artifact-runtime.ts`
- Existing renderer seam updated:
  - `src/renderer/components/Artifact.tsx`
  - `src/renderer/components/chatbridge/chatbridge.ts`
- Focused validation added:
  - `src/shared/chatbridge/bridge-session.test.ts`
  - `src/renderer/packages/chatbridge/bridge/artifact-runtime.test.ts`
  - `test/integration/chatbridge/scenarios/bridge-session-security.test.ts`
  - `src/renderer/components/chatbridge/ChatBridgeShell.test.tsx`

## Validation Outcome

- Focused CB-203 tests passed under Node `20.20.0`:
  `pnpm exec vitest run src/shared/chatbridge/bridge-session.test.ts test/integration/chatbridge/scenarios/bridge-session-security.test.ts src/renderer/components/chatbridge/ChatBridgeShell.test.tsx src/renderer/packages/chatbridge/bridge/artifact-runtime.test.ts src/renderer/components/chat/Message.chatbridge.test.tsx`
- `pnpm test` passed.
- `pnpm check` passed.
- `pnpm lint` passed.
- `pnpm build` passed.
- `git diff --check` passed.

## Rollout and Risk Mitigation

- Rollback strategy:
  keep the change behind the story boundary and prefer reversible schema/runtime updates where practical
- Feature flags/toggles:
  use a targeted toggle if the change affects active user flows or partner-runtime exposure
- Observability checks:
  ensure the new path emits enough structured state to debug launch, failure, and recovery behavior

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
