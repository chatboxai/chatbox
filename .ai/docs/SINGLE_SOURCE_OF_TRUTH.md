# Chatbox Workspace - Single Source of Truth

**Last Updated**: 2026-04-01
**Project Status**: Active
**Canonical App Directory**: repo root
**Canonical Harness Directory**: `.ai/`

## Current Focus

- Keep the imported helper harness generic and accurate for Chatbox.
- Point harness guidance at the real root-level app layout and commands.
- Avoid carrying source-project-specific history, scripts, or runtime
  assumptions into this repo.
- Route UI design through a story-level `design-brief.md` plus Pencil after
  spec/plan and before implementation.

## Repo Baseline

- **Primary rulebook**: `AGENTS.md`
- **Canonical orchestrator**: `.ai/codex.md`
- **Claude-native entry**: `.claude/CLAUDE.md`
- **Claude compatibility mirror**: `.ai/agents/claude.md`
- **Root app package**: `package.json`
- **Primary source areas**: `src/main/`, `src/renderer/`, `src/shared/`
- **Primary test area**: `test/`
- **Primary docs**: `README.md`, `docs/`, `doc/`, `.github/PULL_REQUEST_TEMPLATE.md`
- **Current checked-in deploy surfaces**:
  - hosted web shell: `vercel.json` -> `pnpm build:web` -> `release/app/dist/renderer`
  - mainline deploy automation: `.github/workflows/vercel-main-sync.yml`
  - deploy script: `scripts/deploy-vercel-production.sh`
  - verification script: `scripts/verify-vercel-deployment.sh`
  - deployment reference: `chatbridge/DEPLOYMENT.md`
  - desktop publish config: `electron-builder.yml`
  - current Vercel project: `chatbox-web`
- **UI design baseline**: UI stories keep normal story specs, add
  `docs/specs/<story-id>/design-brief.md`, then use
  `.ai/workflows/pencil-ui-design.md` plus `.ai/docs/PENCIL_UI_WORKFLOW.md` to
  generate 2 or 3 Pencil variations and wait for user approval before code.
- **ChatBridge live inspection baseline**:
  - shared seed catalog: `src/shared/chatbridge/live-seeds.ts`
  - preset bootstrap bundles: `src/renderer/packages/initial_data.ts`
  - preset backfill path: `src/renderer/setup/preset_sessions.ts`
  - dev seeding helper: `src/renderer/dev/chatbridgeSeeds.ts`
  - live inspection route: `/dev/chatbridge`
- **Recommended Pencil asset paths**:
  - `docs/specs/<story-id>/design-brief.md`
  - `design/system/design-system.lib.pen`
  - `design/stories/<story-id>.pen`
- **Validation commands**:
  - `pnpm test`
  - `pnpm check`
  - `pnpm lint`
  - `pnpm build`
  - `git diff --check`
- **Branch rule**: start non-trivial work on a fresh `codex/` branch, carry
  over required local `.env*` files into new branches/worktrees, and run
  `pnpm install` before project commands so missing local `node_modules` is
  treated as setup, not as a story regression. When parallel story branches are
  active, check `main` and `origin/main` before replaying a requested story so
  already-merged work is treated as the baseline, not as something to re-land
  on a stale branch
- **Helper-script rule**: workflow docs may reference optional helper scripts;
  if this repo does not contain them, follow the manual workflow equivalent.

## Execution Guardrails

- `.ai/` is a helper harness for this workspace only.
- Product code belongs in the real app directories, not under `.ai/`.
- Keep durable repo truths in `.ai/memory/project/`.
- Keep current-task notes in `.ai/memory/session/`.
- Align harness guidance with commands that actually exist in `package.json`.
- The main local workflow entrypoints (`pnpm dev`, `pnpm test`, `pnpm check`,
  `pnpm build`, and their direct `start`/`build` variants) now fail fast on
  wrong-Node shells through the repo engine constraints and on stale installs
  through `scripts/workspace-guard.mjs`, before Vite or TypeScript starts.
- For UI-affecting stories, do not skip the design-brief stage or the Pencil
  variation and approval gate.
- For completed stories, do not skip seeded example refresh checks in
  `src/renderer/packages/initial_data.ts`; if no refresh is required, handoff
  must state that explicitly.
- Treat deployment as explicit. If a task does not define a deploy surface, say
  so instead of implying one.
- For the current web host shell, prefer the checked-in Vercel baseline before
  inventing a new provider path.
- For hosted preview verification, prefer `vercel inspect` plus a logged-in
  preview session when Vercel deployment protection blocks anonymous route
  checks.
- For hosted `main` verification, prefer the checked-in Vercel CLI workflow:
  deploy via `.github/workflows/vercel-main-sync.yml` and verify through
  `.ai/workflows/vercel-post-merge-verification.md`.
- Story completion defaults to merged-to-`main`, not just local validation,
  unless the user explicitly pauses or selects a different merge path.
- Final handoff should explain what changed and how to inspect/test it; UI
  stories should call out the exact route or component path plus the expected
  visible result.
- ChatBridge stories that change inspectable runtime behavior should keep the
  preset bootstrap plus the `/dev/chatbridge` live seed lab current and
  reference the exact seeded session in the final audit guidance.

## Read Order

1. `AGENTS.md`
2. `.ai/docs/SINGLE_SOURCE_OF_TRUTH.md`
3. `.ai/codex.md`
4. `README.md`
5. `.ai/docs/WORKSPACE_INDEX.md`
6. for Claude-native sessions: `.claude/CLAUDE.md`
7. for UI stories: `.ai/docs/PENCIL_UI_WORKFLOW.md`
8. relevant repo docs for the surface being changed
