# CB-004 Constitution Check

## Story Context

- Story ID: CB-004
- Story Title: Web deployment and release infrastructure baseline
- Pack: Pack 00 - Foundation and Instrumentation
- Owner: Codex
- Date: 2026-03-31

## Constraints

1. Phase 0 must include real deployment and infrastructure setup, not only
   planning notes.
   Source: user requirement
2. Deployment status must be explicit and evidenced, not implied.
   Source: `AGENTS.md`, `.ai/workflows/deployment-setup.md`
3. The repo should use its current web build as the deployable surface rather
   than inventing a separate stack without a codebase exemplar.
   Source: current repo structure in `package.json` and `electron.vite.config.ts`
4. Future ChatBridge backend services still do not exist and must stay explicit
   as later-pack work.
   Source: `chatbridge/SERVICE_TOPOLOGY.md`

## Structural Map

- `package.json`
- `electron.vite.config.ts`
- `vercel.json`
- `scripts/postbuild-web.mjs`
- root `release-*.sh`
- `chatbridge/DEPLOYMENT.md`
- Pack 00 roadmap docs

## Exemplars

1. `package.json` `build:web`
2. `electron.vite.config.ts`
3. `electron-builder.yml`

## Lane Decision

- Lane: `standard`
- Why: this changes deployment contracts, release entrypoints, env truth, and
  Pack 0 roadmap structure.
- Required gates: full four-artifact packet, deployment workflow, real provider
  evidence, and merged completion.
