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
7. `.ai/docs/PENCIL_UI_WORKFLOW.md` for visible UI stories

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
- Before replaying or re-implementing a requested story from a stale branch,
  check whether the story is already present on `main` or `origin/main`. If it
  is already merged there, treat that merge as the baseline and start any
  follow-up correction from a fresh clean worktree instead of duplicating the
  story on the dirty parallel branch.
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
  `.ai/workflows/trace-driven-development.md` so traces, evals, and observable
  lifecycle seams exist before broad implementation.
- For behavior changes, use `.ai/workflows/tdd-pipeline.md` when practical.
- For visible UI work, keep spec and implementation planning in the normal
  story flow, then run `.ai/workflows/pencil-ui-design.md` through Pencil MCP,
  produce 2 or 3 variations, and stop for explicit approval before code.
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
- The completion gate must include a story explainer that says what changed,
  where it changed, and exactly how to inspect and test it. If the story has a
  UI surface, include the route, click path, expected visible outcome, and the
  proof artifact when available.
- A story is not complete until it is merged to `main` on GitHub, unless the
  user explicitly asks to pause before merge or use a different merge path.
- When parallel story work is active, do not infer completion state from the
  current branch alone. Check the latest base branch and remote first; if the
  requested story is already merged, report that state explicitly and treat any
  remaining changes as a new follow-up story from a clean worktree.
- Unrelated dirty state is not a valid reason to stop at local validation.
  Preserve other in-progress changes, isolate the current story in the safest
  clean branch/worktree available, re-run the required validation on that
  isolated diff, and continue through the full GitHub flow.
- Once the requested work is complete and validated, default to the full GitHub
  flow automatically: commit, push, open or update a PR, merge to `main`, sync
  local `main`, and clean up the story branch unless the user explicitly asks
  to pause finalization or use a different merge path.
- After merges to `main`, the hosted web shell now syncs to Vercel through
  `.github/workflows/vercel-main-sync.yml`. For stories that touch the hosted
  web shell or deployment contract, do not treat finalization as fully closed
  until the Vercel CLI verification phase in that workflow passes or an
  explicit blocker is recorded.
- When a task changes durable process, architecture, or design-system truth,
  update the relevant `.ai/docs/**`, `.ai/memory/**`, or `docs/specs/**`
  artifacts so the checked-in guidance stays current.
