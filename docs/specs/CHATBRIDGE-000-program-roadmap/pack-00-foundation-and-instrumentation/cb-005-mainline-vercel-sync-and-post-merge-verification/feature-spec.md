# CB-005 Feature Spec

## Metadata

- Story ID: CB-005
- Story Title: Mainline Vercel sync and post-merge verification
- Author: Codex
- Date: 2026-03-31
- Related PRD/phase gate: Pack 00 - Foundation and Instrumentation

## Problem Statement

Phase 0 made the hosted web shell real, but production deploy still depends on
manual action and merge completion currently stops before any automatic
post-merge Vercel verification. That leaves the mainline hosted surface out of
the normal workflow.

## Story Pack Objectives

- Higher-level pack goal: establish the execution and infrastructure foundation
- Pack primary objectives: make mainline deployment and verification automatic
- How this story contributes to the pack:
  it adds the automatic `main` -> Vercel sync hook, disables duplicate `main`
  auto-deploys from the Vercel Git integration, and turns post-merge Vercel
  CLI verification into a checked-in workflow phase

## User Stories

- As a maintainer, I want merges to `main` to sync the hosted web shell to
  Vercel automatically so production does not rely on a manual follow-up step.
- As a maintainer, I want post-merge verification to use the Vercel CLI
  directly so the workflow proves the deployment is ready and serving the
  expected build.

## Acceptance Criteria

- [ ] AC-1: A checked-in GitHub Actions workflow deploys the hosted web shell
      to Vercel automatically on `push` to `main`.
- [ ] AC-2: The mainline workflow has a separate verification phase that uses
      the Vercel CLI directly to inspect the deployment and validate
      `/healthz.json`.
- [ ] AC-3: The checked-in Vercel config prevents duplicate `main` deploys from
      Vercel Git integration and the new GitHub Actions path.
- [ ] AC-4: Phase 0 docs and harness workflow docs treat post-merge Vercel
      verification as part of the completion path for hosted deploy-surface
      stories.
- [ ] AC-5: The required secret and project-link contract are explicit enough
      for maintainers to enable or debug the workflow without guesswork.

## Edge Cases

- Empty/null inputs: missing `VERCEL_TOKEN` should fail fast with a clear error
- Boundary values: docs-only or non-web merges may still trigger the mainline
  deploy hook; that is acceptable for a Phase 0 hosted shell baseline
- Invalid/malformed data: a malformed `healthz.json` response should fail the
  verification phase
- External-service failures: Vercel build or verification failures should leave
  an explicit merged-but-failed-deploy state instead of silent success

## Non-Functional Requirements

- Security: no deploy token committed; GitHub Actions secret only
- Performance: reuse the existing web build and smoke path
- Observability: record deployment URL and verify commit-linked health payload
- Reliability: avoid duplicate production deploys for the same `main` update

## UI Requirements

- No new visible product UI is required for this story.

## Out of Scope

- Preview-deployment end-to-end tests for PR branches
- Backend service deployment for future ChatBridge control-plane components

## Done Definition

- `push` to `main` triggers a checked-in Vercel production deploy workflow.
- The workflow verifies the deployment using the Vercel CLI and the smoke
  payload.
- Docs and harness workflows reflect the new post-merge verification phase.

## Execution Evidence

- GitHub Actions workflow path: `.github/workflows/vercel-main-sync.yml`
- Deploy script: `scripts/deploy-vercel-production.sh`
- Verify script: `scripts/verify-vercel-deployment.sh`
- Project link source: `.vercel/project.json`
