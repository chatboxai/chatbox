# CB-000 Technical Plan

## Metadata

- Story ID: CB-000
- Story Title: Workspace bootstrap and env contract
- Author: Codex
- Date: 2026-03-30

## Proposed Design

- Components/modules affected:
  - `README.md`
  - `chatbridge/README.md`
  - `chatbridge/BOOTSTRAP.md`
  - `package.json`
  - `electron.vite.config.ts`
  - `src/renderer/variables.ts`
  - `src/renderer/packages/remote.ts`
  - `src/shared/request/chatboxai_pool.ts`
  - `src/shared/request/request.ts`
  - `vitest.config.ts`
- Public interfaces/contracts:
  - required env and secret inventory
  - local bootstrap contract
  - safe-missing-env behavior
  - known bootstrap gaps that later packs must either wire or remove
- Data flow summary:
  developer bootstraps workspace through `pnpm` scripts -> build/test env is
  injected by Electron Vite or Vitest -> runtime request/auth paths consume the
  resulting config -> ChatBridge stories can assume consistent local readiness

## Architecture Decisions

- Decision:
  treat bootstrap/env readiness as an explicit Pack 0 concern instead of ad hoc
  setup per story
- Alternatives considered:
  - defer setup until the first flagship app
  - let each future story document its own env assumptions independently
- Rationale:
  foundational setup uncertainty is a cross-cutting risk and should be handled
  once, early

## Data Model / API Contracts

- Request shape:
  bootstrap and env checks consume local configuration and service assumptions
  already encoded in scripts, build config, and test config
- Response shape:
  readiness summary, missing-env list, and safe-failure guidance
- Storage/index changes:
  documentation-only at this stage

## Concrete Env Inventory

- Core local dev/runtime:
  `USE_LOCAL_API`,
  `USE_BETA_API`,
  `CHATBOX_BUILD_PLATFORM`,
  `CHATBOX_BUILD_TARGET`,
  `NODE_ENV`,
  `DEV_WEB_ONLY`,
  `MAIN_ARGS`,
  `PORT`,
  `START_MINIMIZED`,
  `DEBUG_PROD`,
  `ANALYZE`,
  `ELECTRON_RENDERER_URL`
- Observability/release:
  `SENTRY_AUTH_TOKEN`,
  `SENTRY_RELEASE`,
  `SENTRY_DIST`
- Packaging/notarization:
  `APPLE_ID`,
  `APPLE_ID_PASS`,
  `APPLE_TEAM_ID`
- Test/integration:
  `CHATBOX_LICENSE_KEY`,
  `CHATBOX_TEST_MODELS`,
  `CHATBOX_TEST_TIMEOUT`,
  `TEST_<PROVIDER>_API_KEY`

## Known Gaps

- `README.md` had drifted to an `npm` contract even though the repo is now
  pnpm-based.
- There is no checked-in `.env.example`.
- `USE_LOCAL_CHATBOX` and `USE_BETA_CHATBOX` are declared/consumed in renderer
  code but are not currently injected by the active Electron Vite build config.
  This story documents the gap and leaves the runtime decision to a later story
  unless explicitly pulled forward.

## Dependency Plan

- Existing dependencies used:
  current package scripts, build/test config, remote auth/request utilities
- New dependencies proposed (if any):
  none by default
- Risk and mitigation:
  keep the contract lightweight and grounded in existing bootstrap paths

## Test Strategy

- Unit tests:
  future bootstrap validators or env-parsing helpers
- Integration tests:
  optional readiness smoke checks for local contracts
- E2E or smoke tests:
  bootstrap verification before later pack execution
- Edge-case coverage mapping:
  missing keys, malformed values, unavailable services

## UI Implementation Plan

- Behavior logic modules:
  N/A for now
- Component structure:
  none
- Accessibility implementation plan:
  none
- Visual regression capture plan:
  none

## Rollout and Risk Mitigation

- Rollback strategy:
  documentation-only foundation can evolve safely and should not touch unrelated
  runtime files
- Feature flags/toggles:
  not applicable yet
- Observability checks:
  missing-env and setup failures should be visible and actionable

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
