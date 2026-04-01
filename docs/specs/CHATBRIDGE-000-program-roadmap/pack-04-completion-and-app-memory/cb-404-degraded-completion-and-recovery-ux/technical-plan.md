# CB-404 Technical Plan

## Metadata

- Story ID: CB-404
- Story Title: Degraded completion and recovery UX
- Author: Codex
- Date: 2026-04-01

## Proposed Design

- Components/modules affected:
- `src/renderer/components/chatbridge/`
- `src/renderer/components/chat/Message.tsx`
- `src/shared/chatbridge/`
- `design/stories/`
- Public interfaces/contracts:
- Degraded completion state model
- User-facing recovery action contract
- Timeline fallback rendering behavior
- Live seeded inspection fixture contract
- Data flow summary:
  Host detects invalid or missing completion -> lifecycle state moves to degraded -> timeline renders host-owned recovery UI -> user can retry, resume, or fall back to chat explanation.
- Approved Pencil variation:
  Variation C, `Conversation-First Recovery Rail`, from `docs/specs/CHATBRIDGE-000-program-roadmap/pack-04-completion-and-app-memory/cb-404-degraded-completion-and-recovery-ux/artifacts/pencil/ACBjW.png`

## Architecture Decisions

- Decision:
  Represent degraded app endings as explicit host states with recovery UI rather than generic timeline errors.
- Alternatives considered:
- Show only a toast or generic message error
- Hide degraded completion details from the user
- Rationale:
  Users must be able to continue the conversation safely even when an app lifecycle ends imperfectly.

## Data Model / API Contracts

- Request shape:
  Inputs should follow the contracts above and be validated before any host-side state transition.
- Response shape:
  Outputs should be normalized into host-owned records or timeline artifacts rather than ad hoc partner payloads.
- Storage/index changes:
  This story updates only the specific host/session/runtime records it needs, carries degraded metadata in `MessageAppPart.values`, preserves those fields through hydration, and keeps the broader ChatBridge model forward-compatible.

## Dependency Plan

- Existing dependencies used:
  current Chatbox session schema, renderer/timeline patterns, and model/tool orchestration seams
- New dependencies proposed (if any):
  none by default; prefer existing stack and utilities unless implementation proves a real gap
- Risk and mitigation:
  keep the work inside existing seams and add targeted tests before broad refactors

## Test Strategy

- Unit tests:
- Invalid/missing completion fallback behavior
- Renderer state coverage for degraded completion
- Recovery action accessibility coverage
- Live seed degraded recovery catalog coverage
- Integration tests:
  cover the full host/runtime path touched by this story rather than only isolated helpers
- E2E or smoke tests:
  add a focused smoke path if the story changes user-visible app flow or session continuity
- Edge-case coverage mapping:
  stale state, malformed inputs, and degraded fallback behavior should be covered explicitly

## UI Implementation Plan

- Behavior logic modules:
  host/runtime/state rules should live outside presentational UI components
- Component structure:
  use approved Chatbox layout and design-system patterns and the approved Pencil variation
- Accessibility implementation plan:
  define keyboard behavior, roles, labels, and readable status/error states for any surfaced UI
- Visual regression capture plan:
  use the approved Pencil artifact plus the live seeded `/dev/chatbridge` degraded recovery fixture as the inspect path for post-implementation verification

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
