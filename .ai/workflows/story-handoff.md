# Story Handoff Workflow (Combined Completion Gate)

**Purpose**: Deliver one user-facing completion packet that combines
verification evidence, manual audit guidance, and the finalization plan so
approval and finalization happen in one clean gate.

## When To Run

Run this workflow at the end of every implementation task.

## Required Completion Gate Shape

Every completion gate must include:

- `Current Status`
- `Testing Brief`
- `Decision / Design Brief`
- `Docs / Memory`
- `Visible Proof`
- `GitHub Status`
- `Completion Plan`
- `User Audit Checklist (Run This Now)`

The completion gate is incomplete if any of these sections are missing.

## TDD Evidence Requirements

When `.ai/workflows/tdd-pipeline.md` was used, also include:

- TDD handoff artifact path
- RED/GREEN checkpoint evidence
- optional quality gate outcomes that were run or skipped

## Docs / Memory Requirements

The completion gate should answer:

- what docs or memory files were updated, or
- `N/A` with a one-line reason

For UI stories that used Pencil, also include:

- approved `.pen` artifact path
- selected variation
- whether implementation matched an already-approved design or included a fresh
  design-review cycle

## Completion Plan Requirements

The completion gate must include the finalization plan in the same packet as
the user audit:

- current branch
- target base branch
- writable remote
- current GitHub state: `local-only`, `pushed-without-PR`, `open PR`, or
  `merged`
- proposed commit message
- expected deploy status: `deployed`, `not deployed`, or `blocked`
- recovery path: `.ai/workflows/finalization-recovery.md`
- if unrelated WIP exists in the current worktree, the clean isolation plan
  instead of treating the dirty tree as a finish blocker

## User Audit Checklist Requirements

- focus on manual judgment, visible proof, or approval decisions
- do not offload routine terminal verification Codex could run itself
- name the exact route, click path, or state to inspect when UI changed
- include expected outcome and failure hint for each step

## Feedback Rules

1. Treat this completion gate as the main user-facing review step.
2. If the user gives narrow corrective feedback, run
   `.ai/workflows/user-correction-triage.md`.
3. If the diff changes materially after feedback, issue a revised completion
   gate.
4. Unless the user explicitly asks to pause or use a different merge path, move
   directly into `.ai/workflows/git-finalization.md` after issuing the
   completion gate. Unrelated WIP in the current worktree is not a stop
   condition; isolate first rather than ending at "validation passed."
5. If finalization fails, stop and route to
   `.ai/workflows/finalization-recovery.md`, then return here with updated
   status.

## Exit Criteria

- completion evidence summarized clearly
- GitHub state and merge status made explicit so the user never has to guess
  whether work is only local, on a PR, or already merged
- finalization plan included in the same packet as the user audit
- docs and memory status explicit
- finalization default is explicit and visible in the completion gate, with
  automatic follow-through unless the user pauses it
- story completion is defined as merged-to-`main` on GitHub unless the user
  explicitly pauses or selects a different merge path
