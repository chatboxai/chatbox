# Workspace Agent Instructions

`AGENTS.md` is the primary checked-in rulebook for this repository.
If another checked-in instruction file disagrees with this file, follow
`AGENTS.md`.

## Read Order

Load context in this order before making non-trivial changes:

1. `AGENTS.md`
2. `.ai/docs/SINGLE_SOURCE_OF_TRUTH.md`
3. `.ai/codex.md`
4. `README.md`
5. `.ai/docs/WORKSPACE_INDEX.md`
6. `.ai/agents/claude.md` for Claude-compatible tools
7. `.ai/docs/UI_DESIGN_WORKFLOW.md` for visible UI stories

## Working Model

- Treat `.ai/` as helper scaffolding for this workspace, not as product code.
- Treat the repo root as the runnable application surface for Chatbox.
- Treat `design/` and `docs/specs/` as checked-in design and story evidence,
  not runtime implementation.
- Keep the harness repo-scoped and generic to Chatbox work; do not import
  external-project backlog, deploy, or feature memory into `.ai/`.
- Prefer checked-in docs and code over chat memory when deciding what to build
  next.

## Story Rules

- Start non-trivial work on a fresh `codex/` branch.
- If the current worktree already contains unrelated in-progress changes or
  another active story, start the new story in a fresh `codex/` worktree/branch
  instead of layering onto the shared dirty tree.
- When a story starts in a fresh branch or worktree, copy the required local
  `.env*` files from the working `main` setup or previous story worktree before
  running project commands, and keep them untracked.
- Start non-trivial work with `agent-preflight` and publish the brief before
  edits.
- Do a preparation pass before edits: inspect the relevant code, contracts, and
  docs first.
- Use `.ai/workflows/story-lookup.md` before meaningful implementation.
- Use `.ai/workflows/story-sizing.md` to classify `trivial` versus `standard`.
- For broader or ambiguous feature work, use
  `.ai/skills/spec-driven-development.md` and write the relevant artifacts under
  `docs/specs/<story-id>/`.
- For model/orchestration/app-runtime/auth-heavy work, run
  `.ai/workflows/trace-driven-development.md`. In this repo, "trace-driven
  development" means LangSmith-backed trace threads plus representative
  scenario coverage for the important behaviors and edge cases, not merely
  adding ad hoc spans. The story should define and prove traced happy-path,
  malformed/error, degraded/timeout, and continuity scenarios before broad
  implementation is treated as done.
- When a story changes inspectable ChatBridge shell, lifecycle, history, or
  HTML-preview behavior, update the live seed catalog in
  `src/shared/chatbridge/live-seeds.ts`, the dev seeding helper in
  `src/renderer/dev/chatbridgeSeeds.ts`, and the `/dev/chatbridge` lab so the
  change is testable in the live app.
- For behavior changes, use `.ai/workflows/tdd-pipeline.md` when practical.
- For visible UI work, keep spec and implementation planning in the normal
  story flow, then run `.ai/workflows/autonomous-ui-design.md` to write the
  design brief, gather repo-grounded design research, generate 2 or 3
  prompt-based directions, score them autonomously, and record the chosen
  direction before code.
- For every completed story, refresh the seeded visual example data in
  `src/renderer/packages/initial_data.ts` so local and production seeded
  examples stay current with the latest behavior. If no update is needed, say
  so explicitly in the completion handoff.
- Keep narrow corrections narrow; do not silently expand scope.
- When a change has non-obvious tradeoffs, pause and confirm direction before
  taking the more expensive path.

## Validation Rules

Run validation from the repo root:

- `pnpm test`
- `pnpm check`
- `pnpm lint`
- `pnpm build`
- `git diff --check`

If the change touches `.ai/`, re-read the source-of-truth files and verify the
harness still matches the actual repo layout and commands.

## Finalization Default

- Do not assume deploy work exists unless the story explicitly adds it.
- Use `.ai/workflows/story-handoff.md` as the completion gate.
- A story is not complete until it is merged to `main` on GitHub, unless the
  user explicitly asks to pause before merge or use a different merge path.
- Unrelated dirty state is not a valid reason to stop at local validation.
  Preserve other in-progress changes, isolate the current story in the safest
  clean branch/worktree available, re-run the required validation on that
  isolated diff, and continue through the full GitHub flow.
- Once the requested work is complete and validated, default to the full GitHub
  flow automatically: commit, push, open or update a PR, merge to `main`, sync
  local `main`, and clean up the story branch unless the user explicitly asks
  to pause finalization or use a different merge path.
- When a task changes durable process, architecture, or design-system truth,
  update the relevant `.ai/docs/**`, `.ai/memory/**`, or `docs/specs/**`
  artifacts so the checked-in guidance stays current.
