# Chatbox Claude Code Orchestrator

This file keeps Claude-compatible tools aligned with the same workflow contract
used by Codex and the root workspace entry files.

## How Claude Loads This Workspace

Claude should discover this repo through the root and Claude-native entry
files:

1. `AGENTS.md`
2. `.ai/docs/SINGLE_SOURCE_OF_TRUTH.md`
3. `.claude/CLAUDE.md` when present

This file (`.ai/agents/claude.md`) carries the workflow contract those entry
files reference.

## Startup Order

1. Read `AGENTS.md`
2. Read `.ai/docs/SINGLE_SOURCE_OF_TRUTH.md`
3. Read `.ai/codex.md`
4. Read `README.md`
5. Read `.ai/docs/WORKSPACE_INDEX.md` when repo orientation is needed
6. Route to the correct workflow in `.ai/workflows/`

## Core Gates

- For non-trivial work, use a fresh `codex/` branch/worktree. If the current
  worktree already has unrelated WIP, move the story into a clean worktree
  instead of sharing the dirty tree.
- When a story starts in a fresh branch/worktree, copy the required local
  `.env*` files from the working `main` setup or previous story worktree, run
  `pnpm install` before project commands, and keep copied env files untracked.
- Run `agent-preflight` before non-trivial edits.
- Use `.ai/workflows/story-lookup.md` before meaningful implementation.
- Use `.ai/workflows/story-sizing.md` to classify the task.
- For UI-affecting stories, run `.ai/workflows/pencil-ui-design.md` after the
  story spec and technical plan exist, and stop for user approval before code.
- For behavior changes, use `.ai/workflows/tdd-pipeline.md`.
- For broader feature work, use `.ai/skills/spec-driven-development.md`.
- For `.ai/` changes, use `.ai/workflows/ai-architecture-change.md`.
- For completion, use `.ai/workflows/story-handoff.md`, then continue through
  `.ai/workflows/git-finalization.md` by default unless the user explicitly
  pauses or chooses a different merge path.
- During git finalization, unrelated dirty state is not a valid stop condition:
  preserve it, isolate the story diff, rerun validation there, and continue
  through merge unless safe disentangling is impossible.

## Task Routing

- Feature -> `.ai/workflows/feature-development.md`
- Bug fix -> `.ai/workflows/bug-fixes.md`
- Performance -> `.ai/workflows/performance-optimization.md`
- Security -> `.ai/workflows/security-review.md`
- Deployment -> `.ai/workflows/deployment-setup.md`
- UI design and review -> `.ai/workflows/pencil-ui-design.md`
- Git finalization -> `.ai/workflows/git-finalization.md`

## Workspace Facts

- Product code lives in the repo root, especially `src/` and `test/`
- Validation commands are `pnpm test`, `pnpm check`, `pnpm lint`, `pnpm build`
- Harness files under `.ai/` are support material, not product code
- UI designs should come from approved Pencil variations, not code-first design
  exploration
