# Decisions Today

- 2026-03-30: Imported the reusable `.ai` harness baseline from a neighboring
  repo, then pruned source-project state, history, and workflow assumptions so
  the harness matches Chatbox.
- 2026-03-30: Standardized harness validation guidance around the real root
  commands in this repo: `pnpm test`, `pnpm check`, `pnpm lint`, `pnpm build`,
  and `git diff --check`.
- 2026-03-30: Replaced the internal harness-owned UI design docs/templates with
  a Pencil-first workflow: spec and technical plan first, then 2 or 3 Pencil
  variations from a shared design-system foundation, explicit user approval, and
  only then implementation.
- 2026-03-31: Standardized parallel-story handling so agents must check
  `main`/`origin/main` before replaying a requested story from a stale branch;
  already-merged work is now treated as the baseline and any extra change
  starts as a clean follow-up story/worktree.
- 2026-04-01: Stabilized ChatBridge chess local web development by explicitly
  prebundling `chess.js` in the renderer `optimizeDeps` contract and locking it
  with a focused regression test, so cold `pnpm dev:web` starts do not throw a
  missing-module overlay before the dependency optimizer catches up.
- 2026-04-01: Added a repo-local workspace guard so stale-install worktrees now
  fail before Vite/TypeScript starts, while wrong-Node shells still fail at the
  repo engine gate. `pnpm install` now records a worktree-local install stamp
  in `node_modules/`.
