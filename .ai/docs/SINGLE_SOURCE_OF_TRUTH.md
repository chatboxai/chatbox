# Chatbox Workspace - Single Source of Truth

**Last Updated**: 2026-03-30
**Project Status**: Active
**Canonical App Directory**: repo root
**Canonical Harness Directory**: `.ai/`

## Current Focus

- Keep the imported helper harness generic and accurate for Chatbox.
- Point harness guidance at the real root-level app layout and commands.
- Avoid carrying source-project-specific history, scripts, or runtime
  assumptions into this repo.
- Route UI design through Pencil after spec/plan and before implementation.

## Repo Baseline

- **Primary rulebook**: `AGENTS.md`
- **Canonical orchestrator**: `.ai/codex.md`
- **Claude-native entry**: `.claude/CLAUDE.md`
- **Claude compatibility mirror**: `.ai/agents/claude.md`
- **Root app package**: `package.json`
- **Primary source areas**: `src/main/`, `src/renderer/`, `src/shared/`
- **Primary test area**: `test/`
- **Primary docs**: `README.md`, `docs/`, `doc/`, `.github/PULL_REQUEST_TEMPLATE.md`
- **UI design baseline**: UI stories keep normal story specs, then use
  `.ai/workflows/pencil-ui-design.md` plus `.ai/docs/PENCIL_UI_WORKFLOW.md` to
  generate 2 or 3 Pencil variations and wait for user approval before code.
- **Recommended Pencil asset paths**:
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
  treated as setup, not as a story regression
- **Helper-script rule**: workflow docs may reference optional helper scripts;
  if this repo does not contain them, follow the manual workflow equivalent.

## Execution Guardrails

- `.ai/` is a helper harness for this workspace only.
- Product code belongs in the real app directories, not under `.ai/`.
- Keep durable repo truths in `.ai/memory/project/`.
- Keep current-task notes in `.ai/memory/session/`.
- Align harness guidance with commands that actually exist in `package.json`.
- For UI-affecting stories, do not skip the Pencil variation and approval gate.
- Treat deployment as explicit. If a task does not define a deploy surface, say
  so instead of implying one.
- Story completion defaults to merged-to-`main`, not just local validation,
  unless the user explicitly pauses or selects a different merge path.

## Read Order

1. `AGENTS.md`
2. `.ai/docs/SINGLE_SOURCE_OF_TRUTH.md`
3. `.ai/codex.md`
4. `README.md`
5. `.ai/docs/WORKSPACE_INDEX.md`
6. for Claude-native sessions: `.claude/CLAUDE.md`
7. for UI stories: `.ai/docs/PENCIL_UI_WORKFLOW.md`
8. relevant repo docs for the surface being changed
