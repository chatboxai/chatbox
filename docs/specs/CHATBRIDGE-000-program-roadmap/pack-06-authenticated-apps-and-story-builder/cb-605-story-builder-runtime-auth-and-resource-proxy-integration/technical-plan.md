# CB-605 Technical Plan

## Metadata

- Story ID: CB-605
- Story Title: Story Builder runtime auth and resource proxy integration
- Author: Codex
- Date: 2026-04-02

## Proposed Design

- Components/modules affected:
  - `src/main/chatbridge/auth-broker/index.ts`
  - `src/main/chatbridge/resource-proxy/index.ts`
  - `src/renderer/components/chatbridge/apps/story-builder/StoryBuilderPanel.tsx`
  - `src/renderer/components/chatbridge/apps/surface.tsx`
  - `src/renderer/components/chatbridge/chatbridge.ts`
  - `src/shared/chatbridge/story-builder.ts`
- Public interfaces/contracts:
  - Story Builder runtime action -> auth broker request contract
  - Story Builder runtime action -> host-mediated resource proxy request
  - live Story Builder status and degraded-auth state contract
- Data flow summary:
  user launches Story Builder -> host runtime requests auth as needed -> handle
  issuance and resource actions go through host-owned broker/proxy ->
  Story Builder surface updates save/resume/completion state -> degraded and
  expiry cases stay inside the normalized host recovery contract.

## Architecture Decisions

- Decision:
  treat Story Builder as the live proof point for Pack 06 host-mediated auth
  and resource access, not as a seeded UI shell.
- Alternatives considered:
  - keep auth/resource seams test-only and rely on seeded cards for demos
  - let Story Builder perform direct resource access in the renderer
- Rationale:
  Pack 06 is only credible if the flagship authenticated app uses the validated
  host-owned path in real runtime behavior.

## Data Model / API Contracts

- Request shape:
  Story Builder actions should use validated auth and resource contracts instead
  of ad hoc request objects.
- Response shape:
  auth and resource outcomes should normalize into host-owned Story Builder
  runtime state and inline status messaging.
- Storage/index changes:
  existing Story Builder state records may need richer runtime status fields,
  but avoid introducing a parallel persistence model.

## Dependency Plan

- Existing dependencies used:
  Pack 06 auth broker, credential handles, resource proxy, Story Builder shell,
  Pack 04 completion continuity, and bridge/runtime adoption work
- New dependencies proposed (if any):
  none by default
- Risk and mitigation:
  keep seeded examples synchronized with the live runtime but do not let them
  remain the only proof of behavior

## Test Strategy

- Unit tests:
  - Story Builder runtime action normalization
  - auth-expiry and retry state handling
- Integration tests:
  prove live Story Builder launch, connect, save, resume, and completion use
  the host-owned auth and resource paths
- E2E or smoke tests:
  rerun live Story Builder prompt flow and seeded-session recovery checks with
  trace capture
- Edge-case coverage mapping:
  auth denial, handle expiry, proxy failures, reload continuity, and repeated
  save/resume actions should be covered explicitly

## UI Implementation Plan

- Behavior logic modules:
  keep auth/resource orchestration in host/runtime packages and feed normalized
  state into Story Builder presentation components
- Component structure:
  reuse `StoryBuilderPanel` and existing ChatBridge shell composition for
  visible state
- Accessibility implementation plan:
  auth-required, connected, saving, expired, and retry states need readable
  labels and keyboard-safe action affordances
- Visual regression capture plan:
  capture connect, saving, resume, expired-auth, and degraded-resource states
  if visible UI changes beyond the approved shell

## Rollout and Risk Mitigation

- Rollback strategy:
  keep runtime auth/resource integration isolated to Story Builder so Pack 06
  primitives remain intact if the live wiring needs partial rollback
- Feature flags/toggles:
  acceptable if a staged live Story Builder rollout is needed during smoke
  rebuild
- Observability checks:
  emit traces for auth request, handle issuance, resource request, save,
  completion, and degraded-auth recovery

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
