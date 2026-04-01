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
- Before replaying a requested story from a stale branch, verify whether that
  story is already merged on `main` or `origin/main`. If it is, treat that
  merge as the baseline and start any additional correction from the latest
  base branch instead of duplicating the old story on a parallel branch.
- When a story starts in a fresh branch or worktree, copy the required local
  `.env*` files from the working `main` setup or previous story worktree, then
  run `pnpm install` before project commands. Keep copied env files untracked.
- Keep `.ai/` aligned with the real repo layout and commands.
- For behavior changes, use `.ai/workflows/tdd-pipeline.md`.
- For larger or ambiguous feature work, use
  `.ai/skills/spec-driven-development.md` and the templates under
  `.ai/templates/spec/`.
- For model/orchestration/app-runtime/auth-heavy work, run
  `.ai/workflows/trace-driven-development.md` so traces, evals, and observable
  lifecycle seams are established early.
- When a story changes inspectable ChatBridge shell, lifecycle, history, or
  HTML-preview behavior, update `src/shared/chatbridge/live-seeds.ts`,
  `src/renderer/packages/initial_data.ts`,
  `src/renderer/setup/preset_sessions.ts`,
  `src/renderer/dev/chatbridgeSeeds.ts`, and the `/dev/chatbridge` lab so the
  change stays seedable in both the default app bootstrap and the live audit
  flow.
- For UI-affecting work, keep spec and implementation planning in the normal
  story flow, require `docs/specs/<story-id>/design-brief.md`, then route
  visual exploration through `.ai/workflows/pencil-ui-design.md`.
- For Pencil work, sync the official Pencil docs locally and review the synced
  `.pen` schema/design-system references before touching `.pen` files.
- For Pencil work, treat Pencil MCP as the default bridge. Verify Pencil in
  `/mcp` and use MCP-backed design operations instead of probing for a direct
  shell `pencil` command as the normal path.
- Do not implement new or changed UI before the user reviews Pencil variations
  and explicitly approves or requests tweaks.
- Story finish: use `.ai/workflows/story-handoff.md`; unless the user
  explicitly asks to pause or choose a different merge path, continue through
  `.ai/workflows/git-finalization.md` automatically after the completion gate,
  and treat the story as incomplete until it is merged to `main` on GitHub.
- For every completed story, refresh the seeded visual example data in
  `src/renderer/packages/initial_data.ts` or call out `N/A` explicitly in the
  completion handoff.
- The completion gate must include a plain-language story explainer covering
  what changed, where it changed, and how the user should inspect and test it.
  For UI changes, include the route or entry path, the visible expected result,
  and the proof artifact when available.
- For ChatBridge stories that change inspectable behavior, also state whether
  the `/dev/chatbridge` seed lab was updated and which seeded session the user
  should reseed/open for live verification.
- For stories that touch the hosted web shell or deployment contract, merge is
  followed by `.ai/workflows/vercel-post-merge-verification.md`; treat the
  story as operationally incomplete until the `Vercel Main Sync` workflow
  passes or an explicit blocker is recorded.
- Shared dirty worktrees are not a finish blocker. Preserve unrelated WIP,
  isolate the story diff in a clean branch/worktree, rerun the required
  validation there, and continue through finalization unless safe
  disentangling is impossible.

## Route By Task Type

- Feature implementation -> `.ai/workflows/feature-development.md`
- Bug fix -> `.ai/workflows/bug-fixes.md`
- Performance -> `.ai/workflows/performance-optimization.md`
- Security review -> `.ai/workflows/security-review.md`
- Deployment or release wiring -> `.ai/workflows/deployment-setup.md`
- Post-merge Vercel verification -> `.ai/workflows/vercel-post-merge-verification.md`
- Pencil UI design and review -> `.ai/workflows/pencil-ui-design.md`
- TDD coordination -> `.ai/workflows/tdd-pipeline.md`
- Git finalization -> `.ai/workflows/git-finalization.md`
- Recovery after failed finalization -> `.ai/workflows/finalization-recovery.md`

## Implementation Defaults

- Product code, package manifests, and tests live at the repo root.
- Primary code areas are `src/main/`, `src/renderer/`, `src/shared/`, and
  `test/`.
- UI story packets use the normal feature-spec and technical-plan artifacts,
  plus `design-brief.md` and `pencil-review.md` when visible UI scope exists.
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
