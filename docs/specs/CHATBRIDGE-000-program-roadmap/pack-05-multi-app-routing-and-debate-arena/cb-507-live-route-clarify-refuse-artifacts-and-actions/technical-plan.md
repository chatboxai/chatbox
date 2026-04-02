# CB-507 Technical Plan

## Metadata

- Story ID: CB-507
- Story Title: Live route clarify refuse artifacts and actions
- Author: Codex
- Date: 2026-04-02

## Proposed Design

- Components/modules affected:
  - `src/shared/chatbridge/routing.ts`
  - `src/renderer/packages/chatbridge/router/decision.ts`
  - `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
  - `src/renderer/components/chatbridge/chatbridge.ts`
  - `src/renderer/components/chat/Message.tsx`
  - `design/stories/`
- Public interfaces/contracts:
  - route-decision artifact payload
  - clarify action payload and follow-up launch contract
  - refusal artifact rendering contract
- Data flow summary:
  live route decision resolves to invoke, clarify, or refuse -> invoke proceeds
  to app launch, clarify renders an actionable artifact, refusal renders a
  host-owned explanation artifact -> user action feeds back into reviewed-app
  route state and launch control.

## Architecture Decisions

- Decision:
  render route outcomes as dedicated host-owned timeline artifacts instead of
  burying them in raw assistant text or test-only structures.
- Alternatives considered:
  - silently choose the top-ranked app
  - encode clarify/refusal as plain text responses with no structured action
- Rationale:
  reviewed-app routing is a core user-visible platform behavior and should be
  explainable, durable, and testable as UI, not only as routing logic.

## Data Model / API Contracts

- Request shape:
  route-decision payloads should remain validated and reason-coded before they
  reach renderer components.
- Response shape:
  user choices from clarify artifacts should round-trip through host-owned route
  and launch logic, not raw model text.
- Storage/index changes:
  persisted messages should retain enough route-artifact structure to survive
  reload and history navigation.

## Dependency Plan

- Existing dependencies used:
  reviewed route decisions, host-owned message rendering seams, and ChatBridge
  shell surfaces
- New dependencies proposed (if any):
  none by default
- Risk and mitigation:
  keep route-artifact data normalized and reuse current timeline patterns so
  persistence and reload behavior stay predictable

## Test Strategy

- Unit tests:
  - clarify and refusal artifact normalization
  - action handling and stale-action rejection
- Integration tests:
  prove a live ambiguous prompt produces a clarify artifact and a live chat-only
  prompt produces a refusal artifact
- E2E or smoke tests:
  rerun ambiguous and chat-only manual smoke prompts end to end
- Edge-case coverage mapping:
  stale choices, unknown reason codes, reload persistence, and post-clarify
  launch failure should be covered explicitly

## UI Implementation Plan

- Behavior logic modules:
  keep route artifact state and action handling outside presentational
  components
- Component structure:
  render dedicated route artifacts through existing ChatBridge message part and
  timeline surfaces
- Accessibility implementation plan:
  clarify choices need keyboard focus order, labels, and stateful disabled or
  completed messaging
- Visual regression capture plan:
  capture clarify, refusal, and degraded-action states after Pencil approval

## Rollout and Risk Mitigation

- Rollback strategy:
  keep the route-artifact renderer isolated so invoke-path repairs can stand
  independently if needed
- Feature flags/toggles:
  acceptable if live clarify/refuse needs staged manual smoke rollout
- Observability checks:
  emit route-decision traces for invoke, clarify, refusal, and post-clarify
  selection behavior

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
