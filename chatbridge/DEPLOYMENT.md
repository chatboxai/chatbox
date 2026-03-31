# ChatBridge Deployment and Infrastructure Foundation

This document turns Pack 0 deployment from a planning note into a real,
checked-in execution contract.

## Current Phase 0 Deployment Surfaces

### Hosted web shell

- Provider: Vercel
- Project: `chatbox-web` (`prj_sDopuiczqA5vk8DFehkhClQkOooe`)
- Checked-in config: `vercel.json`
- Hosted runtime: Node 20.x
- Build command: `pnpm build:web`
- Output directory: `release/app/dist/renderer`
- Deep-link handling: catch-all SPA rewrite to `index.html`
- Smoke path: `/healthz.json`
- Access model: Vercel preview protected by team authentication unless the team
  changes deployment-protection policy in Vercel settings

### Desktop release pipeline

- Packaging: `electron-builder`
- Checked-in config: `electron-builder.yml`
- Release entrypoints:
  - `pnpm release:mac`
  - `pnpm release:linux`
  - `pnpm release:win`
- Root wrappers:
  - `release-mac.sh`
  - `release-linux.sh`
  - `release-win.sh`
- Update artifact publishing: S3-compatible publish target backed by the
  configured Cloudflare R2 endpoint in `electron-builder.yml`

## What Phase 0 Now Requires

- a checked-in host config for the web shell
- a local smoke path that can be asserted after build and serve
- an explicit env example for deploy and release credentials
- real runnable release/deploy entrypoints instead of missing shell scripts
- deployment status recorded as evidence in the story packet

## Local Test Loop

### Web shell

1. `pnpm install`
2. `pnpm build:web`
3. `pnpm serve:web`
4. Open the app locally and verify `http://localhost:3000/healthz.json`

### Desktop packaging

1. `pnpm install`
2. `pnpm package`
3. Use the platform-specific release wrapper only when publish credentials are
   present

## Deploy Commands

### Web

- `pnpm deploy:web:preview`
- `pnpm deploy:web:prod`

These commands route through `release-web.sh`. Preview is the safe default for
Phase 0 validation; production is an explicit choice.

## Recorded Provider Evidence

- Verified preview deployment:
  `https://chatbox-3ev0v910o-thisisyoussefs-projects.vercel.app`
- Inspector URL:
  `https://vercel.com/thisisyoussefs-projects/chatbox-web/2XcjSGjddrYDf8XgEnRoN2fUPBMt`
- Deployment ID: `dpl_2XcjSGjddrYDf8XgEnRoN2fUPBMt`
- Verification method:
  `vercel inspect https://chatbox-3ev0v910o-thisisyoussefs-projects.vercel.app --wait`
- Verified status on 2026-03-31: `Ready`
- Hosted route note:
  anonymous `curl` returns Vercel Authentication because team-level deployment
  protection is enabled; team members should test the preview in a logged-in
  browser session or via Vercel-authenticated tooling

### Desktop

- `pnpm release:mac`
- `pnpm release:linux`
- `pnpm release:win`

## Secret and Credential Contract

The checked-in `.env.example` is the baseline reference.

Important categories:

- web/static deployment:
  - no runtime secret is required for the static shell itself
  - `SENTRY_AUTH_TOKEN`, `SENTRY_RELEASE`, and `SENTRY_DIST` are optional
    release-metadata inputs
- desktop publishing:
  - `UPDATE_CHANNEL`
  - `AWS_ACCESS_KEY_ID`
  - `AWS_SECRET_ACCESS_KEY`
  - `AWS_REGION`
  - `APPLE_ID`
  - `APPLE_ID_PASS`
  - `APPLE_TEAM_ID`

## Execution Status Rule

Phase 0 is only considered deployment-complete when:

- the checked-in config exists
- local smoke validation passes
- at least one real hosted preview deployment exists with recorded evidence

## Remaining Explicit Gaps

The following are still not deployed services in Phase 0:

- ChatBridge registry service
- policy service
- auth broker
- durable app-instance or event-stream backend

## Known Deploy Caveat

- Vercel install logs still show the legacy `zipfile` native module failing to
  compile during `pnpm install` on Linux, but the static web-shell preview
  still completes successfully because the Phase 0 web build does not depend on
  that native binary at runtime.

Those remain later-pack backend work and should not be implied by the existence
of the hosted web shell.
