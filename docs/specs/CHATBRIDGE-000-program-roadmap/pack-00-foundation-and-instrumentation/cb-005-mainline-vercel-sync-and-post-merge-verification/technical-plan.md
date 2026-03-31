# CB-005 Technical Plan

## Metadata

- Story ID: CB-005
- Story Title: Mainline Vercel sync and post-merge verification
- Author: Codex
- Date: 2026-03-31

## Proposed Design

- Components/modules affected:
  - `vercel.json`
  - `.github/workflows/vercel-main-sync.yml`
  - `scripts/deploy-vercel-production.sh`
  - `scripts/verify-vercel-deployment.sh`
  - `.env.example`
  - `chatbridge/DEPLOYMENT.md`
  - `chatbridge/README.md`
  - Pack 00 roadmap docs
  - `.ai` deploy and finalization workflows
- Public interfaces/contracts:
  - mainline deploy trigger on `push` to `main`
  - `VERCEL_TOKEN` GitHub Actions secret contract
  - deploy script contract returning a deployment URL
  - verification contract checking `healthz.json` and expected commit SHA
- Data flow summary:
  merge -> GitHub Actions `push main` -> install deps -> `pnpm build:web` ->
  Vercel production deploy -> capture deployment URL -> `vercel inspect` and
  `vercel curl /healthz.json` -> pass or fail the post-merge verification phase

## Architecture Decisions

- Decision:
  make GitHub Actions the explicit `main` deployment hook and disable Vercel
  Git auto-deploy only for `main`
- Alternatives considered:
  - keep Vercel dashboard auto-deploys and add only documentation
  - use repository-dispatch events without a checked-in deploy workflow
  - leave deploy and verification as manual post-merge operator steps
- Rationale:
  a checked-in CI workflow is reviewable, reproducible, and keeps the deploy
  and verification contract in the repo instead of in dashboard-only settings

## Data Model / API Contracts

- Request shape:
  `scripts/verify-vercel-deployment.sh <deployment-url> [target] [commit-sha]`
- Response shape:
  `healthz.json` must include `status`, `app`, `version`, `buildPlatform`, and
  optional `commitSha`
- Storage/index changes:
  GitHub workflow only; no application storage changes

## Concrete Deployment Contract

- Trigger:
  GitHub Actions on `push` to `main`
- Provider:
  Vercel production deployment for the hosted web shell
- Build path:
  `pnpm build:web`
- Deploy path:
  `bash scripts/deploy-vercel-production.sh`
- Verify path:
  `bash scripts/verify-vercel-deployment.sh <deployment-url> production <sha>`
- Duplicate deploy guard:
  `vercel.json` sets `git.deploymentEnabled.main = false`

## Dependency Plan

- Existing dependencies used:
  current Vercel project link, Vercel CLI, existing smoke artifact
- New dependencies proposed (if any):
  none; install Vercel CLI in CI
- Risk and mitigation:
  keep only `main` auto-deploy disabled in Vercel config so the GitHub Action
  is the single production-deploy path while not overreaching into later pack
  deploy requirements

## Test Strategy

- Unit tests:
  none; shell/workflow surface
- Integration tests:
  validate the scripts locally where credentials exist and in GitHub Actions
- E2E or smoke tests:
  Vercel CLI inspect + healthz verification after a `main` deploy
- Edge-case coverage mapping:
  missing token, malformed health payload, failed deploy parsing, and duplicate
  deploy prevention are all covered by explicit script/workflow failure modes

## UI Implementation Plan

- Behavior logic modules:
  none
- Component structure:
  none
- Accessibility implementation plan:
  not applicable
- Visual regression capture plan:
  health and deploy verification only

## Rollout and Risk Mitigation

- Rollback strategy:
  revert the GitHub Actions workflow, scripts, and `vercel.json` mainline
  deploy override
- Feature flags/toggles:
  not needed; this is infrastructure wiring
- Observability checks:
  use the Vercel CLI to wait, inspect, and verify the deployed health payload

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
