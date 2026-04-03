# Chatbox Workspace - Claude Code Entry Point

This is the primary Claude-native instruction file for this workspace.

## Read Order

Before making non-trivial changes, load context in this order:

1. `.claude/CLAUDE.md`
2. `AGENTS.md`
3. `.ai/docs/SINGLE_SOURCE_OF_TRUTH.md`
4. `README.md`
5. `.ai/agents/claude.md`
6. `.ai/docs/WORKSPACE_INDEX.md`

For deeper context when needed:

- `.ai/memory/project/patterns.md`
- `.ai/memory/project/anti-patterns.md`
- `.ai/memory/session/active-context.md`
- `.ai/docs/UI_DESIGN_WORKFLOW.md` for UI stories

## Workspace Layout

```text
.ai/           Helper harness only - workflows, templates, memory, references
design/        Legacy checked-in design evidence when historical assets exist
docs/specs/    Story specs, design briefs, decision docs, and implementation evidence
src/           Product source code
test/          Tests
AGENTS.md      Primary checked-in rulebook
```

Rule: `.ai/` is scaffolding for this workspace only. Product code, tests, and
application docs live in the normal repo root directories.

## Validation Commands

Run from the repo root:

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```

## Story Rules

- Start non-trivial work on a fresh `codex/` branch.
- If the current worktree already contains unrelated in-progress changes or
  another active story, start the new story in a fresh `codex/` worktree/branch
  instead of layering onto the shared dirty tree.
- When a story starts in a fresh branch or worktree, copy the required local
  `.env*` files from the working `main` setup or previous story worktree before
  running project commands, and keep them untracked.
- Run `agent-preflight` before non-trivial edits and publish the brief.
- Do a preparation pass before edits: read the relevant code, docs, and
  contracts first.
- Use `.ai/workflows/story-lookup.md` before meaningful implementation.
- Use `.ai/workflows/story-sizing.md` to classify `trivial` versus `standard`.
- For broader or ambiguous feature work, use
  `.ai/skills/spec-driven-development.md` and create spec artifacts under
  `docs/specs/<story-id>/`.
- Use `.ai/workflows/tdd-pipeline.md` for behavior changes when practical.
- Keep narrow corrections narrow and pause on non-obvious tradeoffs.

## UI Workflow

When a story changes visible UI:

1. Keep spec writing and technical planning in the normal story flow.
2. Use `.ai/workflows/autonomous-ui-design.md`.
3. Write `design-brief.md` and gather repo-grounded design research.
4. Produce 2 or 3 prompt-based directions and score them autonomously.
5. Record the chosen direction and proceed without pausing for design approval
   unless the user explicitly asks for it.

## Workflow Routing

| Task Type | Workflow |
|---|---|
| Feature | `.ai/workflows/feature-development.md` |
| Bug fix | `.ai/workflows/bug-fixes.md` |
| Performance | `.ai/workflows/performance-optimization.md` |
| Security | `.ai/workflows/security-review.md` |
| Deployment | `.ai/workflows/deployment-setup.md` |
| UI design and review | `.ai/workflows/autonomous-ui-design.md` |
| TDD coordination | `.ai/workflows/tdd-pipeline.md` |
| Git finalization | `.ai/workflows/git-finalization.md` |

## Completion

- Use `.ai/workflows/story-handoff.md` as the completion gate.
- Unless the user explicitly asks to pause or use a different merge path,
  continue through `.ai/workflows/git-finalization.md` automatically after the
  completion gate.
- Story completion defaults to merged-to-`main`, not just local validation.
- If the task changes durable process, architecture, or design-system truth,
  update the relevant `.ai/docs/**`, `.ai/memory/**`, or `docs/specs/**`
  artifacts before wrapping up.

## App Architecture

- Electron main process: `src/main/`
- Preload bridge: `src/preload/`
- Renderer app: `src/renderer/`
- Shared contracts and helpers: `src/shared/`
- Tests: `test/` and `src/__tests__/`
- UI design artifacts: `docs/specs/<story-id>/design-brief.md`,
  `design-research.md`, `design-decision.md`
- Legacy Pencil assets may exist under `design/`, but they are not the default
  workflow for new UI stories.
