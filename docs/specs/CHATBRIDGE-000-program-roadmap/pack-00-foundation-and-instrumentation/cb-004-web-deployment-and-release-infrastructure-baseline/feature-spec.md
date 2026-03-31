# CB-004 Feature Spec

## Metadata

- Story ID: CB-004
- Story Title: Web deployment and release infrastructure baseline
- Author: Codex
- Date: 2026-03-31
- Related PRD/phase gate: Pack 00 - Foundation and Instrumentation

## Problem Statement

Pack 0 previously documented deployment assumptions without creating a real
hosted surface, smoke path, or runnable release entrypoints. That leaves later
packs assuming infrastructure that does not actually exist.

## Story Pack Objectives

- Higher-level pack goal: establish the execution and infrastructure foundation
- Pack primary objectives: make Phase 0 deployment real and testable
- How this story contributes to the pack:
  it creates the checked-in host config, smoke validation path, env contract,
  and release entrypoints that make deployment a real foundation instead of a
  planning-only note

## User Stories

- As a maintainer, I want a real hosted Phase 0 web surface so deployment is
  testable before ChatBridge feature packs depend on it.
- As a developer, I want release entrypoints and env examples that actually
  exist so `package.json` and docs do not point to broken or missing scripts.

## Acceptance Criteria

- [x] AC-1: The repo contains a checked-in hosting config for the web shell.
- [x] AC-2: The web build emits a stable smoke path that can be asserted after
      local serve and hosted deploy.
- [x] AC-3: Release and deploy entrypoints referenced by `package.json` exist
      and are runnable.
- [x] AC-4: Pack 0 docs and roadmap truth explicitly distinguish the deployed
      host shell from future backend services that still do not exist.
- [x] AC-5: Deployment execution status is recorded with real provider
      evidence, not only local claims.

## Edge Cases

- Empty/null inputs: missing publish credentials should block release commands
  but not local development or local web smoke checks
- Boundary values: preview deploy should work without implying the future
  platform control plane exists
- Invalid/malformed data: missing or malformed env values should fail visibly
  in release steps
- External-service failures: deployment errors must produce explicit `blocked`
  or `not deployed` status instead of silent ambiguity

## Non-Functional Requirements

- Security: no secrets committed; deploy credentials stay local/provider-side
- Performance: the web deploy path should reuse the existing static build
  instead of inventing a second renderer stack
- Observability: the smoke path should expose build metadata for quick
  deployment verification
- Reliability: release entrypoints should fail fast when required credentials
  are missing

## UI Requirements

- No new visible product UI is required for this story.

## Out of Scope

- Building the future ChatBridge backend control plane
- Shipping full CI/CD for every release surface

## Done Definition

- A real hosted web-shell deployment path exists in the repo.
- The web build exposes a smoke-check artifact and local verification loop.
- Root release scripts exist for the surfaces referenced by `package.json`.
- Pack 0 docs treat deployment as real and record execution evidence.

## Execution Evidence

- Vercel project: `chatbox-web`
- Deployment ID: `dpl_2XcjSGjddrYDf8XgEnRoN2fUPBMt`
- Preview URL:
  `https://chatbox-3ev0v910o-thisisyoussefs-projects.vercel.app`
- Inspector URL:
  `https://vercel.com/thisisyoussefs-projects/chatbox-web/2XcjSGjddrYDf8XgEnRoN2fUPBMt`
- Verification:
  - local smoke passed at `http://localhost:3000/healthz.json`
  - hosted preview reached `Ready` via `vercel inspect`
  - hosted route access is currently protected by Vercel team authentication
