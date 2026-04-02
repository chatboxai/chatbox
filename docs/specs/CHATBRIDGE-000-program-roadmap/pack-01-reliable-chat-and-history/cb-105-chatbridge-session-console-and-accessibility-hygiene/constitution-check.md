# CB-105 Constitution Check

## Story Context

- Story ID: CB-105
- Story Title: ChatBridge session console and accessibility hygiene
- Pack: Pack 01 - Reliable Chat and History
- Owner: Codex
- Date: 2026-04-02

## Constraints

1. Keep narrow corrections narrow; do not silently expand scope into a shell
   redesign.
   Source: `AGENTS.md`
2. Use the checked-in story packet contract for standard-lane work.
   Source: `.ai/skills/spec-driven-development.md`
3. Preserve the current chat/session rendering patterns rather than inventing a
   parallel message shell.
   Sources: `src/renderer/components/chat/`, `src/renderer/components/common/`
4. Preserve validation baseline when implementation begins.
   Source: `package.json`
5. Treat the smoke audit findings as the source of truth for the bug scope.
   Source: `docs/specs/CHATBRIDGE-000-program-roadmap/smoke-audit-master.md`

## Structural Map

- Likely surface: `src/renderer/components/common/`
- Likely surface: `src/renderer/components/chat/`
- Likely surface: `src/renderer/routes/`

## Exemplars

1. `src/renderer/components/chat/Message.tsx`
   Existing message-shell rendering precedent.
2. `src/renderer/components/common/Avatar.tsx`
   Likely prop-forwarding seam implicated by the warning.
3. `src/renderer/components/dev/ChatBridgeSeedLab.tsx`
   Existing smoke path used to reproduce the issues.

## Lane Decision

- Lane: `standard`
- Why: this is a cross-cutting UI quality fix touching shared chat surfaces and
  accessibility behavior.
- Required gates: constitution check, feature spec, technical plan, task
  breakdown, focused TDD during implementation.

## Outcome Notes

- This story exists to clean the baseline around ChatBridge smoke sessions, not
  to claim feature progress on the runtime rebuild itself.
