# CB-105 Technical Plan

## Metadata

- Story ID: CB-105
- Story Title: ChatBridge session console and accessibility hygiene
- Author: Codex
- Date: 2026-04-02

## Proposed Design

- Components/modules affected:
  - `src/renderer/components/common/Avatar.tsx`
  - `src/renderer/components/chat/Message.tsx`
  - shell or modal/focus-management surfaces implicated by the smoke warning
- Public interfaces/contracts:
  - prop filtering contract for user/system avatars and message shells
  - accessible hidden-state/focus behavior in the shell
- Data flow summary:
  seeded ChatBridge session renders -> shell/components mount -> warning-free
  console and safe focus transitions

## Architecture Decisions

- Decision:
  fix the narrow component and shell seams that emit the warnings rather than
  muting warnings globally.
- Alternatives considered:
  - ignore the warnings as cosmetic
  - suppress them in tooling
- Rationale:
  the smoke audit needs cleaner signal, and accessibility/focus warnings usually
  point to real shell quality issues.

## Data Model / API Contracts

- Request shape:
  none
- Response shape:
  none
- Storage/index changes:
  none

## Dependency Plan

- Existing dependencies used:
  current chat shell, avatar, message rendering, and dev-tools navigation
- New dependencies proposed (if any):
  none
- Risk and mitigation:
  keep the change narrow and add regression tests around the affected UI paths

## Test Strategy

- Unit tests:
  - prop filtering for the warning-producing component path
- Integration tests:
  - shell or route transition behavior that previously triggered the
    `aria-hidden` warning
- E2E or smoke tests:
  - rerun seeded ChatBridge session smoke and inspect console logs
- Edge-case coverage mapping:
  focus changes, hidden-state transitions, and empty session rendering should be
  exercised explicitly

## UI Implementation Plan

- Behavior logic modules:
  keep focus-management behavior outside presentational leaf components where
  practical
- Component structure:
  preserve current layout and styling
- Accessibility implementation plan:
  prefer `inert` or safer focus management over hiding a subtree that still owns
  focus
- Visual regression capture plan:
  not required unless the fix changes visible shell behavior

## Rollout and Risk Mitigation

- Rollback strategy:
  keep the fix localized to the warning-producing components
- Feature flags/toggles:
  none expected
- Observability checks:
  verify the known console warnings disappear from the smoke console log

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
