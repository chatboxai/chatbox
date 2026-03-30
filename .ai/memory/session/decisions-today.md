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
