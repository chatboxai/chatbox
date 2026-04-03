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
- For broad or ambiguous new product and major-feature work, run
  `.ai/workflows/product-building.md` before treating the request as a normal
  implementation story.
- For standard-lane stories that still need source-backed synthesis or a
  defended recommendation after lookup, run
  `.ai/workflows/brainlift-research.md`.
- Use `.ai/workflows/story-sizing.md` to classify the task.
- For model/orchestration/app-runtime/auth-heavy work, run
  `.ai/workflows/trace-driven-development.md`. Here, trace-driven development
  means LangSmith-backed scenario/thread evidence for representative behaviors
  and edge cases, not just adding trace hooks.
- For UI-affecting stories, run `.ai/workflows/autonomous-ui-design.md` after
  the story spec and technical plan exist so the design brief, research, and
  autonomous direction lock before code.
- When a story changes inspectable ChatBridge shell, lifecycle, history, or
  HTML-preview behavior, update `src/shared/chatbridge/live-seeds.ts`,
  `src/renderer/packages/initial_data.ts`,
  `src/renderer/setup/preset_sessions.ts`,
  `src/renderer/dev/chatbridgeSeeds.ts`, and the `/dev/chatbridge` lab so the
  change stays seedable in both the default app bootstrap and the live audit
  flow.
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
- Product shaping -> `.ai/workflows/product-building.md`
- Research-backed story shaping -> `.ai/workflows/brainlift-research.md`
- Bug fix -> `.ai/workflows/bug-fixes.md`
- Performance -> `.ai/workflows/performance-optimization.md`
- Security -> `.ai/workflows/security-review.md`
- Deployment -> `.ai/workflows/deployment-setup.md`
- UI design and review -> `.ai/workflows/autonomous-ui-design.md`
- Git finalization -> `.ai/workflows/git-finalization.md`

## Workspace Facts

- Product code lives in the repo root, especially `src/` and `test/`
- Validation commands are `pnpm test`, `pnpm check`, `pnpm lint`, `pnpm build`
- Harness files under `.ai/` are support material, not product code
- UI designs should come from recorded design briefs, research, and autonomous
  design decisions, not code-first exploration
