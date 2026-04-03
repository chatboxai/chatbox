# Decisions Today

- 2026-03-30: Imported the reusable `.ai` harness baseline from a neighboring
  repo, then pruned source-project state, history, and workflow assumptions so
  the harness matches Chatbox.
- 2026-03-30: Standardized harness validation guidance around the real root
  commands in this repo: `pnpm test`, `pnpm check`, `pnpm lint`, `pnpm build`,
  and `git diff --check`.
- 2026-04-02: Replaced the active Pencil gate with an autonomous UI design
  workflow: spec and technical plan first, then a design brief, targeted design
  research, 2 or 3 prompt-based directions, autonomous scoring, and a recorded
  design decision before implementation.
