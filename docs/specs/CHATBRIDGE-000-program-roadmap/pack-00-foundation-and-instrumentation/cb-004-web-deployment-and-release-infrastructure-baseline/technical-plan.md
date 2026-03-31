# CB-004 Technical Plan

## Metadata

- Story ID: CB-004
- Story Title: Web deployment and release infrastructure baseline
- Author: Codex
- Date: 2026-03-31

## Proposed Design

- Components/modules affected:
  - `package.json`
  - `electron.vite.config.ts`
  - `.env.example`
  - `vercel.json`
  - `scripts/postbuild-web.mjs`
  - `release-web.sh`
  - `release-mac.sh`
  - `release-linux.sh`
  - `release-win.sh`
  - `README.md`
  - `chatbridge/BOOTSTRAP.md`
  - `chatbridge/DEPLOYMENT.md`
  - `chatbridge/SERVICE_TOPOLOGY.md`
  - roadmap Pack 00 docs and harness memory
- Public interfaces/contracts:
  - web deployment contract for the hosted shell
  - smoke-check contract at `/healthz.json`
  - release/deploy command contract in `package.json`
  - Pack 0 deployment evidence contract
- Data flow summary:
  `pnpm build:web` -> static renderer output -> postbuild health artifact ->
  local `pnpm serve:web` smoke loop and Vercel-hosted preview deploy -> later
  runtime API calls still resolve through the existing Chatbox remote request
  layer

## Architecture Decisions

- Decision:
  use the current static web shell as the Phase 0 deployable surface
- Alternatives considered:
  - wait for a future ChatBridge backend before any deployment work
  - invent a separate deployment target unrelated to the current web build
- Rationale:
  the repo already has a web build surface; making that deployable is the
  narrowest honest way to make Phase 0 deployment real now

## Data Model / API Contracts

- Request shape:
  web deployment is static and does not add a new runtime API contract
- Response shape:
  `/healthz.json` returns static build metadata suitable for smoke checks
- Storage/index changes:
  documentation and static artifact only

## Concrete Deployment Contract

- Provider:
  Vercel for the hosted web shell
- Project:
  `chatbox-web`
- Hosted runtime:
  Node 20.x
- Build path:
  `pnpm build:web`
- Output path:
  `release/app/dist/renderer`
- Routing:
  SPA rewrite to `index.html`
- Smoke path:
  `/healthz.json`
- Hosted verification:
  `vercel inspect <preview-url> --wait`, because preview access is currently
  protected by team-level Vercel authentication
- Desktop publishing:
  keep `electron-builder.yml` as the publish contract and restore the missing
  root wrapper scripts referenced by `package.json`

## Dependency Plan

- Existing dependencies used:
  Vite/electron-vite web build, electron-builder desktop publish config, and
  current Pack 0 docs
- New dependencies proposed (if any):
  none; rely on Vercel config plus optional `npx vercel`
- Risk and mitigation:
  keep the provider config minimal and use the existing web build instead of
  adding a second build system

## Test Strategy

- Unit tests:
  none required for static config and shell scripts
- Integration tests:
  local web smoke via `pnpm serve:web` and `GET /healthz.json`
- E2E or smoke tests:
  one real hosted preview deployment with recorded URL evidence
- Edge-case coverage mapping:
  missing deploy creds, missing publish creds, and missing env values fail in
  the relevant commands instead of silently defaulting

## UI Implementation Plan

- Behavior logic modules:
  no new product UI
- Component structure:
  none
- Accessibility implementation plan:
  not applicable
- Visual regression capture plan:
  use the existing web shell, no new UI variance introduced

## Rollout and Risk Mitigation

- Rollback strategy:
  revert `vercel.json`, the wrapper scripts, and the Pack 0 docs if the deploy
  contract proves wrong
- Feature flags/toggles:
  no feature flag required because this story configures build and deploy
  surfaces, not user-facing behavior
- Observability checks:
  verify the generated `/healthz.json` payload locally and verify hosted deploy
  readiness through Vercel inspect plus a logged-in preview session

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
