# CB-605 Constitution Check

## Story Context

- Story ID: CB-605
- Story Title: Story Builder runtime auth and resource proxy integration
- Pack: Pack 06 - Authenticated Apps and Story Builder
- Owner: Codex
- Date: 2026-04-02

## Constraints

1. Keep credentials and resource access host-owned; the app runtime must never
   receive raw long-lived credentials.
   Source: `chatbridge/PRESEARCH.md`, `chatbridge/ARCHITECTURE.md`
2. Follow the repo's four-artifact story contract for standard-lane work.
   Source: `.ai/skills/spec-driven-development.md`
3. Reuse the existing auth broker, credential-handle, and resource-proxy
   contracts instead of inventing Story Builder-specific auth plumbing.
   Sources: `src/main/chatbridge/auth-broker/`,
   `src/main/chatbridge/resource-proxy/`, `src/shared/chatbridge/`
4. Keep Story Builder inside existing ChatBridge shell patterns and reopen
   Pencil only if new visible states exceed the approved direction.
   Sources: `.ai/docs/PENCIL_UI_WORKFLOW.md`,
   `src/renderer/components/chatbridge/apps/story-builder/`
5. Preserve the repo validation baseline when implementation begins.
   Source: `package.json`

## Structural Map

- Likely surface: `src/main/chatbridge/auth-broker/`
- Likely surface: `src/main/chatbridge/resource-proxy/`
- Likely surface: `src/shared/chatbridge/story-builder.ts`
- Likely surface: `src/renderer/components/chatbridge/apps/story-builder/`
- Likely surface: `test/integration/chatbridge/scenarios/`

## Exemplars

1. `src/main/chatbridge/auth-broker/index.ts`
   Host-owned auth lifecycle precedent.
2. `src/main/chatbridge/resource-proxy/index.ts`
   Host-mediated resource access precedent.
3. `src/renderer/components/chatbridge/apps/story-builder/StoryBuilderPanel.tsx`
   Existing Story Builder shell and state-rendering precedent.
4. `test/integration/chatbridge/scenarios/story-builder-lifecycle.test.ts`
   Existing flagship app proof shape to make live-runtime honest.

## Lane Decision

- Lane: `standard`
- Why: this story changes runtime auth, resource access, and flagship app
  behavior across multiple layers.
- Required gates: constitution check, feature spec, technical plan, task
  breakdown, focused TDD during implementation, and smoke-trace verification.

## Outcome Notes

- Opened from `smoke-audit-master.md` finding SA-004.
- This story depends on the bridge/runtime and live invocation backfills so
  Story Builder can stop behaving like a seeded-only shell.
