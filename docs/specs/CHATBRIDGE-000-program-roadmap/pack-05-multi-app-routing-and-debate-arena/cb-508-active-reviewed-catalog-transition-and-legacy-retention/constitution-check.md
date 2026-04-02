# CB-508 Constitution Check

## Story Context

- Story ID: CB-508
- Story Title: Active reviewed catalog transition and legacy retention
- Pack: Pack 05 - Multi-App Routing and Debate Arena
- Owner: Codex
- Date: 2026-04-02

## Constraints

1. Keep the reviewed-partner model intact and explicit while changing the
   active flagship inventory.
   Source: `chatbridge/PRESEARCH.md`, `chatbridge/ARCHITECTURE.md`
2. Follow the repo's four-artifact story contract for standard-lane work.
   Source: `.ai/skills/spec-driven-development.md`
3. Preserve legacy app code and docs as references instead of deleting them
   silently.
   Source: user direction on 2026-04-02
4. Keep active versus legacy truth centralized in the reviewed catalog, seeds,
   and roadmap docs rather than scattered one-off notes.
   Sources: `src/shared/chatbridge/reviewed-app-catalog.ts`,
   `src/shared/chatbridge/live-seeds.ts`,
   `docs/specs/CHATBRIDGE-000-program-roadmap/`
5. Preserve the repo validation baseline when implementation begins.
   Source: `package.json`

## Structural Map

- Likely surface: `chatbridge/PRESEARCH.md`
- Likely surface: `chatbridge/ARCHITECTURE.md`
- Likely surface: `src/shared/chatbridge/reviewed-app-catalog.ts`
- Likely surface: `src/shared/chatbridge/live-seeds.ts`
- Likely surface: `src/renderer/packages/initial_data.ts`
- Likely surface: `docs/specs/CHATBRIDGE-000-program-roadmap/`

## Exemplars

1. `docs/specs/CHATBRIDGE-000-program-roadmap/progress.md`
   Current control ledger that needs the new active queue.
2. `src/shared/chatbridge/reviewed-app-catalog.ts`
   Default runtime membership seam.
3. `src/shared/chatbridge/live-seeds.ts`
   Seeded session truth that should stay aligned with active runtime.
4. `chatbridge/PRESEARCH.md`
   Current flagship recommendation that this story will supersede.

## Lane Decision

- Lane: `standard`
- Why: this story changes the active product roadmap and runtime inventory
  rather than a narrow leaf behavior.
- Required gates: constitution check, feature spec, technical plan, task
  breakdown, and focused TDD during implementation.

## Outcome Notes

- This story supersedes the active direction behind `CB-505` without deleting
  the older packet.
- Debate Arena and Story Builder should remain accessible as legacy references,
  not active flagship commitments.
