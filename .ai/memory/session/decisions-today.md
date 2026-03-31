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
