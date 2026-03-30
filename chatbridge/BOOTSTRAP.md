# ChatBridge Bootstrap and Env Contract

This document is the Pack 0 bootstrap contract for ChatBridge work in this
repository. It is grounded in the current repo seams and should be treated as
the setup baseline before product-facing ChatBridge stories begin.

## Current Baseline

- Package manager: `pnpm`
- Supported Node runtime: `>=20.0.0 <23.0.0`
- Checked-in local version pin: `.node-version` -> `v20.20.0`
- Primary app scripts live in `package.json`
- Build/runtime env injection currently flows through
  `electron.vite.config.ts`
- Renderer runtime flags are consumed via
  `src/renderer/variables.ts`
- Remote API and auth request behavior currently lives in
  `src/renderer/packages/remote.ts`,
  `src/shared/request/chatboxai_pool.ts`,
  and `src/shared/request/request.ts`

## Required Local Bootstrap

1. Install Node 20-22.
2. Install dependencies with `pnpm install`.
3. Start the desktop app with `pnpm dev`.
4. Start against the local Chatbox API with `pnpm dev:local` when backend work
   depends on `http://localhost:8002`.
5. Use `pnpm test`, `pnpm check`, `pnpm lint`, and `pnpm build` as the default
   validation gates.

## Environment Inventory

### Day-to-day local development

- `USE_LOCAL_API`
  - Used by:
    `package.json`,
    `electron.vite.config.ts`,
    `src/renderer/variables.ts`,
    `src/renderer/packages/remote.ts`,
    `src/shared/request/chatboxai_pool.ts`
  - Purpose: route Chatbox API traffic to `http://localhost:8002`
  - Safe missing behavior: defaults to hosted Chatbox API origins

- `USE_BETA_API`
  - Used by:
    `electron.vite.config.ts`,
    `src/renderer/variables.ts`
  - Purpose: reserved beta API flag in current renderer/build contract
  - Safe missing behavior: defaults to production behavior

- `CHATBOX_BUILD_PLATFORM`
  - Used by:
    `package.json`,
    `electron.vite.config.ts`,
    `src/renderer/variables.ts`
  - Purpose: build target selection for web and mobile packaging
  - Safe missing behavior: defaults to `'unknown'`

- `CHATBOX_BUILD_TARGET`
  - Used by:
    `package.json`,
    `electron.vite.config.ts`,
    `src/renderer/variables.ts`
  - Purpose: build target selection for mobile packaging and runtime branching
  - Safe missing behavior: defaults to `'unknown'`

- `NODE_ENV`
  - Used across main, renderer, build, tests, and Sentry setup
  - Purpose: development/test/production branching
  - Safe missing behavior: defaults to development in the build config and
    test config

- `DEV_WEB_ONLY`
  - Used by:
    `package.json`
  - Purpose: local web-only dev mode
  - Safe missing behavior: normal desktop dev mode

- `MAIN_ARGS`
  - Used by:
    `package.json`
  - Purpose: pass Electron main-process debug args
  - Safe missing behavior: no extra debug args

- `PORT`
  - Used by older ERB-side dev tooling and port checks
  - Purpose: renderer/dev server port override where relevant
  - Safe missing behavior: defaults to `1212`

- `START_MINIMIZED`, `DEBUG_PROD`, `ANALYZE`, `ELECTRON_RENDERER_URL`
  - Purpose: local debugging, analysis, and special startup behavior
  - Safe missing behavior: standard startup and no bundle analysis

### Chatbox remote/auth integration

- `CHATBOX_LICENSE_KEY`
  - Used by integration tests and ChatboxAI-specific flows
  - Purpose: unlock licensed/integration-only surfaces in tests
  - Safe missing behavior: relevant integration tests skip or degrade
    intentionally

### Provider integration tests

- `TEST_<PROVIDER>_API_KEY`
  - Used by:
    `test/integration/model-provider/model-provider.test.ts`
  - Purpose: opt into live provider integration coverage
  - Examples:
    - `TEST_OPENAI_API_KEY`
    - `TEST_GEMINI_API_KEY`
    - `TEST_OPENAI_RESPONSES_API_KEY`
  - Safe missing behavior: provider-specific suites do not run

- `CHATBOX_TEST_MODELS`
  - Purpose: narrow file-conversation integration coverage to selected models
  - Safe missing behavior: test defaults are used

- `CHATBOX_TEST_TIMEOUT`
  - Purpose: override long-running integration timeout
  - Safe missing behavior: defaults to `120000`

### Observability and release metadata

- `SENTRY_AUTH_TOKEN`
  - Used by:
    `electron.vite.config.ts`
  - Purpose: sourcemap upload during build/release flows
  - Safe missing behavior: build still works, Sentry upload is skipped

- `SENTRY_RELEASE`
- `SENTRY_DIST`
  - Purpose: explicit release metadata override
  - Safe missing behavior: release falls back to package version and optional
    dist remains unset

### Packaging and notarization

- `APPLE_ID`
- `APPLE_ID_PASS`
- `APPLE_TEAM_ID`
  - Used by:
    `.erb/scripts/notarize.js`
  - Purpose: macOS notarization
  - Safe missing behavior: local development still works, notarization cannot
    run

## Missing-Env and Safe-Default Contract

- Missing optional dev flags should fall back to production-hosted defaults or
  built-in local defaults instead of silently crashing.
- Missing release-only credentials should block release-specific steps, not
  normal development.
- Missing live provider keys should skip provider integration coverage rather
  than failing unrelated test suites.
- Missing license-based integration settings should skip the relevant suites
  with an explicit message.
- Malformed env values should fail visibly in the command that depends on them;
  Pack 0 should not assume hidden coercion is acceptable.

## Current Gaps

- There is no checked-in `.env.example` yet.
- The root
  `README.md` had drifted
  behind the repo's actual `pnpm` setup and needed correction.
- `USE_LOCAL_CHATBOX` and `USE_BETA_CHATBOX` are declared in
  `src/renderer/variables.ts`
  and consumed in
  `src/renderer/packages/remote.ts`,
  but they are not currently injected in
  `electron.vite.config.ts`.
  Treat these as unresolved contract gaps until a later Pack 0 or Pack 1 story
  decides whether to wire or remove them.

## Dependency Map For Later Packs

- Pack 01 depends on this document for the baseline dev/test commands and local
  API assumptions.
- Pack 02 depends on this document for the initial secret/env ownership model
  and authenticated-request seams.
- Pack 03 and later depend on this document for observability and integration
  test prerequisites, not just UI or orchestration plans.
