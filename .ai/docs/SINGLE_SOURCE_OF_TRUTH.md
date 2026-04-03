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
- Route visible UI through an autonomous design brief, research, and decision
  workflow before implementation.

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
  `.ai/workflows/autonomous-ui-design.md` plus
  `.ai/docs/UI_DESIGN_WORKFLOW.md` to write `design-brief.md`, gather
  repo-grounded and source-backed design research when needed, generate 2 or 3
  prompt-based directions, score them autonomously, and record the chosen
  direction before code.
- **Initiative shaping workflow**: use `.ai/workflows/product-building.md` for
  new products, new verticals, and significant features that are not yet clean
  implementation stories.
- **Research validation workflow**: use `.ai/workflows/brainlift-research.md`
  after `story-lookup` when the team still needs a source-backed recommendation
  before locking the story packet.
- **Recommended UI artifact paths**:
  - `docs/specs/<story-id>/design-brief.md`
  - `docs/specs/<story-id>/design-research.md`
  - `docs/specs/<story-id>/design-decision.md`
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
- The main local workflow entrypoints (`pnpm dev`, `pnpm test`, `pnpm check`,
  `pnpm build`, and their direct `start`/`build` variants) now fail fast on
  wrong-Node shells through the repo engine constraints and on stale installs
  through `scripts/workspace-guard.mjs`, before Vite or TypeScript starts.
- For orchestration-heavy stories, trace-driven development means
  LangSmith-backed scenario/thread evidence for representative behaviors and
  edge cases. A few raw spans are not enough; the important flows should be
  reproducible through named traced scenarios or supported manual smoke runs.
- Passing the baseline command suite is necessary but not sufficient for
  production readiness. For bundling, packaging, or deploy-surface changes,
  also verify compiled output loads, risky runtime dependencies are externalized
  correctly when needed, and generated production package metadata includes the
  dependencies the runtime surface requires.
- Prefer explicit, DRY, well-tested code over cleverness, and treat deliberate
  edge-case handling as part of done.
- For authenticated agent endpoints, derive user identity from JWT or request
  context rather than ad hoc database lookups. Keep tool logic pure where
  possible and use framework DI at the boundaries.
- For UI-affecting stories, do not skip the design brief, design research, and
  autonomous direction or decision record.
- For completed stories, do not skip seeded example refresh checks in
  `src/renderer/packages/initial_data.ts`; if no refresh is required, handoff
  must state that explicitly.
- For broad or ambiguous product work, do not skip the product-building or
  BrainLift research steps when the request is not yet story-ready.
- Legacy Pencil docs and `.pen` assets may remain for historical story
  evidence, but they are not the active UI workflow.
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
7. for UI stories: `.ai/docs/UI_DESIGN_WORKFLOW.md`
8. relevant repo docs for the surface being changed
