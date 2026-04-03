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
  - `pnpm check`
  - `pnpm lint`
  - `pnpm build`
- Orchestration-heavy work should establish traces/evals early through
  `.ai/workflows/trace-driven-development.md` instead of waiting for late debug
  cycles.
- In this repo, trace-driven development means representative LangSmith-backed
  scenario/thread evidence for happy-path, edge-case, degraded, and
  continuity/follow-up behavior. It is not satisfied by adding isolated spans
  without a discoverable scenario matrix.
- LangSmith is the checked-in trace sink for whole-app AI observability. Keep
  the API key main-process-owned, use the shared contract in
  `src/shared/utils/langsmith_adapter.ts`, wire renderer code through
  `src/renderer/adapters/langsmith.ts`, and prefer parent chain traces around
  user-visible flows plus child model traces through
  `src/shared/models/tracing.ts`.
- Fresh story branches and worktrees should copy the required local `.env*`
  files from the working `main` setup, run `pnpm install` before project
  commands, and keep copied env files untracked.
- Non-trivial implementation stories should start on fresh `codex/` branches;
  if the current tree is already dirty with another story, isolate the new work
  in a clean worktree rather than sharing the dirty tree.
- Story completion defaults to the full GitHub flow: commit, push, PR, merge to
  `main`, sync local `main`, and branch cleanup unless the user explicitly
  pauses or chooses a different merge path.

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
- UI stories write `design-brief.md` before design direction is locked.
- Visual exploration happens through prompt-based directions after spec/plan and
  before code.
- Existing UI stories inspect the current code surface and closest repo
  exemplars before generating new directions.
- Design research is repo-first and becomes source-backed when the repo does
  not already exemplify the relevant surface or user journey.
- UI stories should produce 2 or 3 materially different directions, score them
  autonomously, and record the winner before implementation.
- The active design evidence for UI stories lives in `design-brief.md`,
  `design-research.md`, and `design-decision.md`.
- The codebase itself is the primary design-system foundation: shared tokens,
  components, states, and layout patterns should be reused before story work
  invents new visual language.
- When UI stories change shared tokens or component contracts, the design
  decision should call out those changes explicitly so code and story docs do
  not drift silently.
