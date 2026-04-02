# CB-305 Technical Plan

## Metadata

- Story ID: CB-305
- Story Title: Bridge host controller adoption for reviewed app launches
- Author: Codex
- Date: 2026-04-02

## Proposed Design

- Components/modules affected:
  - `src/renderer/packages/chatbridge/bridge/host-controller.ts`
  - `src/renderer/components/chatbridge/apps/surface.tsx`
  - `src/renderer/components/chatbridge/chatbridge.ts`
  - `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
  - `src/renderer/components/Artifact.tsx`
- Public interfaces/contracts:
  - reviewed-app launch request -> bridge host controller startup contract
  - bridge event -> host-owned runtime state contract
  - preview artifact rendering must remain a separate, explicit surface
- Data flow summary:
  host route selects reviewed app -> launch surface creates bridge session
  through the host controller -> app events update host-owned state -> shell
  renders runtime state and completion/recovery behavior.

## Architecture Decisions

- Decision:
  treat the bridge host controller as the canonical reviewed-app launch seam.
- Alternatives considered:
  - continue using seeded or synthetic app shells for non-Chess reviewed apps
  - let preview artifact infrastructure continue doubling as app runtime
- Rationale:
  later Pack 05 and Pack 06 rebuilds need one real launch seam. Keeping bridge
  runtime separate from preview artifacts avoids false-positive product proof.

## Data Model / API Contracts

- Request shape:
  reviewed-app launch inputs should be normalized before bridge startup and
  validated against the reviewed manifest/runtime contract.
- Response shape:
  bridge events should remain normalized into host-owned lifecycle, completion,
  and recovery records before rendering.
- Storage/index changes:
  no new durable schema is required by default; this story should primarily
  replace runtime wiring, not invent new persisted state.

## Dependency Plan

- Existing dependencies used:
  current bridge-session contract, host-controlled ChatBridge shell state, and
  Pack 04 lifecycle/summary normalization
- New dependencies proposed (if any):
  none by default
- Risk and mitigation:
  isolate preview artifact code paths and add regression tests so bridge
  adoption does not break existing HTML artifact preview behavior

## Test Strategy

- Unit tests:
  - host controller launch and teardown for reviewed apps
  - event normalization when bridge startup or runtime events fail
- Integration tests:
  prove a reviewed-app launch path now uses the host controller rather than a
  preview-only shell
- E2E or smoke tests:
  extend the smoke harness to confirm bridge launch traces exist for a live
  reviewed-app flow
- Edge-case coverage mapping:
  stale handles, malformed events, duplicate launch attempts, and preview-only
  artifact rendering should be covered explicitly

## UI Implementation Plan

- Behavior logic modules:
  keep launch and lifecycle control in renderer packages, not inside
  presentation-only app components
- Component structure:
  continue using the existing ChatBridge shell and message part surfaces for
  visible runtime states
- Accessibility implementation plan:
  preserve current shell labels and progress/error semantics during bridge
  startup and failure states
- Visual regression capture plan:
  capture loading, active, completion, and degraded bridge states if visible
  shell behavior changes

## Rollout and Risk Mitigation

- Rollback strategy:
  keep preview artifact rendering intact so the bridge adoption diff can be
  reverted without losing unrelated artifact support
- Feature flags/toggles:
  a narrow host-side gate is acceptable if runtime migration needs staged smoke
  proof
- Observability checks:
  emit traceable bridge launch, ready, error, and teardown spans through the
  LangSmith plumbing

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
