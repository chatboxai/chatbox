# Durable Patterns

Capture repeatable patterns that match how this workspace actually works.

## Repo Layout

- Root `.ai/` holds the helper harness only.
- The runnable application lives at the repo root.
- Root-level validation should target the root `package.json`.

## Chatbox App Structure

- Electron main process: `src/main/`
- Preload bridge: `src/preload/`
- Renderer app: `src/renderer/`
- Shared contracts and helpers: `src/shared/`
- Integration and fixture-heavy tests: `test/`
- Smaller colocated tests: `src/__tests__/`
- Product docs: `README.md`, `docs/`, `doc/`

## Testing and Validation

- Tests use Vitest.
- Type checking uses TypeScript strict mode.
- Formatting and linting use Biome.
- Baseline validation set is:
  - `pnpm test`
  - `pnpm run test:chatbridge:edd` for ChatBridge traced behavior
  - `pnpm check`
  - `pnpm lint`
  - `pnpm build`
- Orchestration-heavy work should establish traces/evals early through
  `.ai/workflows/trace-driven-development.md` instead of waiting for late debug
  cycles.
- ChatBridge EDD is local-first: `test/integration/chatbridge/edd/` contains
  the reusable eval scenarios and `test/output/chatbridge-edd/` stores
  vendor-neutral JSON proof for each run.
- Live LangSmith uploads are opt-in for ChatBridge EDD. Use
  `pnpm run test:chatbridge:edd:live` plus
  `.ai/workflows/langsmith-finish-check.md` only when fresh remote evidence is
  required and credentials plus quota are available.
- Fresh story branches and worktrees should copy the required local `.env*`
  files from the working `main` setup, run `pnpm install` before project
  commands, and keep copied env files untracked.
- Non-trivial implementation stories should start on fresh `codex/` branches;
  if the current tree is already dirty with another story, isolate the new work
  in a clean worktree rather than sharing the dirty tree.
- When multiple story branches are active, verify the requested story's status
  on `main` and `origin/main` before replaying it. If the story is already
  merged there, treat that merge as the baseline and branch any additional work
  as a clean follow-up instead of duplicating it on a stale parallel branch.
- Story completion defaults to the full GitHub flow: commit, push, PR, merge to
  `main`, sync local `main`, and branch cleanup unless the user explicitly
  pauses or chooses a different merge path.
- Final handoff packets should include a plain-language explainer of what
  changed plus concrete inspection and testing guidance. UI stories should name
  the route or component path, the click path or entry state, and the expected
  visible outcome.
- Inspectable ChatBridge behavior should stay wired to the live seed lab:
  `src/shared/chatbridge/live-seeds.ts` defines the seeded scenarios,
  `src/renderer/dev/chatbridgeSeeds.ts` upserts them into storage, and
  `/dev/chatbridge` is the live entry point for manual verification.

## Deployment and Release

- The current hosted web-shell baseline is Vercel with checked-in config in
  `vercel.json`.
- The current Vercel project is `chatbox-web`.
- `main` pushes now deploy the hosted web shell through
  `.github/workflows/vercel-main-sync.yml`.
- Mainline deployment is driven by `scripts/deploy-vercel-production.sh`.
- Post-merge hosted verification is driven by
  `scripts/verify-vercel-deployment.sh` and uses the Vercel CLI directly.
- `vercel.json` disables Vercel Git auto-deploy for `main` so GitHub Actions is
  the single checked-in production deploy trigger.
- The canonical web deploy path is `pnpm build:web`, outputting to
  `release/app/dist/renderer`.
- Web smoke verification should use `pnpm serve:web` and
  `GET /healthz.json`.
- Hosted preview verification should use `vercel inspect <preview-url> --wait`
  and a logged-in browser session when Vercel deployment protection blocks
  anonymous HTTP checks.
- Hosted `main` verification should use the `Vercel Main Sync` workflow plus
  Vercel CLI `inspect` and `/healthz.json` verification after merge.
- Deploy-surface closeout should tell the user exactly what to open and inspect
  on the hosted version after merge, not only report merge and workflow status.
- Provider secrets such as `OPENAI_API_KEY` should live only in untracked local
  `.env*` files and Vercel project envs, not in tracked config.
- OpenAI-backed live integration tests may use `OPENAI_API_KEY` as the shared
  fallback secret, while `TEST_OPENAI_API_KEY` and
  `TEST_OPENAI_RESPONSES_API_KEY` remain optional explicit overrides.
- Desktop packaging and publish flows remain rooted in `electron-builder.yml`.
- Root `release-*.sh` files are the checked-in entrypoints for release and
  deploy commands referenced by `package.json`.

## Documentation Pattern

- Repo rules and harness truth live at the root.
- Product-specific implementation docs stay in the normal repo docs folders.
- Durable workflow notes go in `.ai/memory/project/`.
- Current-task notes go in `.ai/memory/session/`.
- Standard feature stories usually live in `docs/specs/<story-id>/`.
- Phase-pack or roadmap planning may nest full four-artifact story packets under
  a program folder like `docs/specs/<program-id>/<pack-id>/<story-id>/` when
  the work is being organized as a multi-pack roadmap.

## UI Workflow Pattern

- UI stories keep normal feature-spec and technical-plan artifacts.
- Pencil stories begin by syncing the official docs locally under
  `.ai/reference/pencil/`.
- Visual exploration happens in Pencil after spec/plan and before code.
- Existing UI stories should import the current code surface into Pencil before
  variations are proposed.
- The shared Pencil design-library foundation lives at
  `design/system/design-system.lib.pen`.
- Story authors should review the local `.pen` schema snapshot before
  hand-editing `.pen` files.
- Story-specific Pencil work should live at `design/stories/<story-id>.pen`.
- UI stories should produce 2 or 3 variations and wait for user approval before
  implementation.
- Design-system maturity should be labeled honestly using
  `.ai/docs/PENCIL_DESIGN_SYSTEM_STANDARD.md`.
- The current Chatbox foundation is a first-pass comprehensive library: shared
  primitives, forms, chrome, content patterns, and layout shells should extend
  `design/system/design-system.lib.pen` before story work invents new shapes.
- When UI stories change shared tokens, Pencil variables should be synced with
  the corresponding code-side variables or token files.
- Approved variation details should be recorded in
  `docs/specs/<story-id>/pencil-review.md`.
- Approved Pencil artifacts should stay in the repo workspace so design and code
  can stay in sync and be versioned together.
