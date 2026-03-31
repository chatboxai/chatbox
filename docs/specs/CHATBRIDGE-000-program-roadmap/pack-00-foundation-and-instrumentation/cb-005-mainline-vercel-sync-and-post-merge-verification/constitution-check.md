# CB-005 Constitution Check

## Story Context

- Story ID: CB-005
- Story Title: Mainline Vercel sync and post-merge verification
- Pack: Pack 00 - Foundation and Instrumentation
- Owner: Codex
- Date: 2026-03-31

## Constraints

1. Once `main` updates, the hosted web shell should sync to Vercel
   automatically.
   Source: user requirement
2. Post-merge verification should monitor Vercel through the Vercel CLI
   directly, not only passive docs or anonymous HTTP checks.
   Source: user requirement, Vercel CLI docs
3. The repo already has a Phase 0 hosted web shell and should extend that
   deploy surface rather than inventing a second provider path.
   Source: `chatbridge/DEPLOYMENT.md`, `vercel.json`, `package.json`
4. The checked-in workflow should avoid duplicate production deploys from both
   Vercel Git integration and GitHub Actions.
   Source: Vercel project-configuration docs, current Vercel baseline

## Structural Map

- `vercel.json`
- `.github/workflows/`
- `scripts/deploy-vercel-production.sh`
- `scripts/verify-vercel-deployment.sh`
- `.vercel/project.json`
- `chatbridge/DEPLOYMENT.md`
- Pack 00 roadmap docs
- `.ai/workflows/deployment-setup.md`
- `.ai/workflows/story-handoff.md`
- `.ai/workflows/git-finalization.md`

## Exemplars

1. `release-web.sh`
2. `vercel.json`
3. `chatbridge/DEPLOYMENT.md`

## Lane Decision

- Lane: `standard`
- Why: this changes deploy automation, GitHub workflow behavior, and the
  post-merge completion contract.
- Required gates: full four-artifact packet, checked-in automation, Vercel CLI
  verification path, and merged completion.
