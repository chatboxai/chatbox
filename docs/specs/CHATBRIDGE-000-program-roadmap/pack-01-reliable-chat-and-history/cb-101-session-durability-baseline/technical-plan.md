# CB-101 Technical Plan

## Metadata

- Story ID: CB-101
- Story Title: Session durability baseline
- Author: Codex
- Date: 2026-03-30

## Proposed Design

- Components/modules affected:
- `src/shared/types/session.ts`
- `src/renderer/routes/session/$sessionId.tsx`
- `src/renderer/lib/format-chat.tsx`
- `src/renderer/stores/sessionHelpers`
- Public interfaces/contracts:
- Session and thread hydration invariants
- Backward-compatible message serialization rules
- Export formatting behavior for future app artifacts
- Data flow summary:
  Renderer session load -> schema validation -> thread/message hydration -> timeline render -> export/format helpers. The story should identify where future app records will enter that flow safely.

## Architecture Decisions

- Decision:
  Extend the current session and thread model in place rather than introducing a parallel ChatBridge-only persistence store.
- Alternatives considered:
- Add a separate app-history store disconnected from session history
- Defer persistence work until after Chess exists
- Rationale:
  Later app lifecycle and memory features will only be trustworthy if they ride on the same durable session model as the rest of Chatbox.

## Data Model / API Contracts

- Request shape:
  Inputs should follow the contracts above and be validated before any host-side state transition.
- Response shape:
  Outputs should be normalized into host-owned records or timeline artifacts rather than ad hoc partner payloads.
- Storage/index changes:
  This story should update only the specific host/session/runtime records it needs and keep the broader ChatBridge model forward-compatible.

## Implemented Compatibility Rules

- Hydration keeps structured `contentParts` intact whenever a message already contains a non-placeholder structured part; legacy `content` is only used to backfill empty or placeholder-only text payloads.
- Thread/archive transitions move `compactionPoints` with the message set they describe and clear them when a fresh thread starts from a clean system prompt.
- Export formatting keeps current text/info/image behavior and emits a stable `[type]` fallback for future structured parts until CB-102 defines first-class app-aware schema/rendering.

## Dependency Plan

- Existing dependencies used:
  current Chatbox session schema, renderer/timeline patterns, and model/tool orchestration seams
- New dependencies proposed (if any):
  none by default; prefer existing stack and utilities unless implementation proves a real gap
- Risk and mitigation:
  keep the work inside existing seams and add targeted tests before broad refactors

## Test Strategy

- Unit tests:
- Session reload with app-capable messages present
- Thread switching and compaction boundaries with non-text message parts
- Markdown/TXT/HTML export behavior remains valid
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
  use approved Chatbox layout and design-system patterns
- Accessibility implementation plan:
  define keyboard behavior, roles, labels, and readable status/error states for any surfaced UI
- Visual regression capture plan:
  capture the key visible states for this story if the implementation introduces a new visible surface

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
