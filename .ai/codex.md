# Chatbox Workspace Orchestrator (Codex)

`.ai/codex.md` is the canonical workspace orchestrator.
Keep startup context small, route quickly, and use the workflow files for
detailed procedure.

## Read First

Always read:

- `AGENTS.md`
- `README.md`
- `.ai/docs/SINGLE_SOURCE_OF_TRUTH.md`

Then use as needed:

- `.ai/docs/WORKSPACE_INDEX.md`
- `.ai/memory/project/patterns.md`
- `.ai/memory/project/anti-patterns.md`
- `.ai/memory/session/active-context.md`

## Required Gates

- New task preflight: run `agent-preflight`, publish the brief, and use a fresh
  `codex/` branch for non-trivial work before edits.
- If the current worktree is already dirty from another story or agent, move
  the new work into a clean worktree instead of sharing the dirty tree.
- When a story starts in a fresh branch or worktree, copy the required local
  `.env*` files from the working `main` setup or previous story worktree, then
  run `pnpm install` before project commands. Keep copied env files untracked.
- Keep `.ai/` aligned with the real repo layout and commands.
- For behavior changes, use `.ai/workflows/tdd-pipeline.md`.
- For broad or ambiguous new product and major-feature work, run
  `.ai/workflows/product-building.md` before locking per-story implementation.
- For standard-lane stories that still need source-backed synthesis or a
  defended recommendation after lookup, run
  `.ai/workflows/brainlift-research.md`.
- For larger or ambiguous feature work, use
  `.ai/skills/spec-driven-development.md` and the templates under
  `.ai/templates/spec/`.
- For model/orchestration/app-runtime/auth-heavy work, run
  `.ai/workflows/trace-driven-development.md` so traces, evals, and observable
  lifecycle seams are established early.
- For UI-affecting work, keep spec and implementation planning in the normal
  story flow, then route design through
  `.ai/workflows/autonomous-ui-design.md`.
- For UI work, require `design-brief.md` plus a recorded design decision before
  code, and require source-backed design research when the repo does not
  already exemplify the relevant surface or pattern.
- Do not stop for human design approval by default; the autonomous design lane
  should choose and record a direction unless the user explicitly asks to
  review design before code.
- Story finish: use `.ai/workflows/story-handoff.md`; unless the user
  explicitly asks to pause or choose a different merge path, continue through
  `.ai/workflows/git-finalization.md` automatically after the completion gate,
  and treat the story as incomplete until it is merged to `main` on GitHub.
- Shared dirty worktrees are not a finish blocker. Preserve unrelated WIP,
  isolate the story diff in a clean branch/worktree, rerun the required
  validation there, and continue through finalization unless safe
  disentangling is impossible.

## Route By Task Type

- Feature implementation -> `.ai/workflows/feature-development.md`
- Product shaping or significant feature definition ->
  `.ai/workflows/product-building.md`
- Research-backed decision shaping -> `.ai/workflows/brainlift-research.md`
- Bug fix -> `.ai/workflows/bug-fixes.md`
- Performance -> `.ai/workflows/performance-optimization.md`
- Security review -> `.ai/workflows/security-review.md`
- Deployment or release wiring -> `.ai/workflows/deployment-setup.md`
- Autonomous UI design and review -> `.ai/workflows/autonomous-ui-design.md`
- TDD coordination -> `.ai/workflows/tdd-pipeline.md`
- Git finalization -> `.ai/workflows/git-finalization.md`
- Recovery after failed finalization -> `.ai/workflows/finalization-recovery.md`

## Implementation Defaults

- Product code, package manifests, and tests live at the repo root.
- Primary code areas are `src/main/`, `src/renderer/`, `src/shared/`, and
  `test/`.
- Root validation commands are:
  - `pnpm test`
  - `pnpm check`
  - `pnpm lint`
  - `pnpm build`
  - `git diff --check`
- Keep `.ai/memory/project/*` focused on durable repo truths.
- Keep `.ai/memory/session/*` focused on current work, not imported history.

## Memory Update Set

- `.ai/docs/SINGLE_SOURCE_OF_TRUTH.md`
- `.ai/memory/project/architecture.md`
- `.ai/memory/project/patterns.md`
- `.ai/memory/project/anti-patterns.md`
- `.ai/memory/codex/README.md`
- `.ai/memory/session/decisions-today.md`
