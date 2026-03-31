# Story Handoff Workflow (Combined Completion Gate)

**Purpose**: Deliver one user-facing completion packet that combines
verification evidence, manual audit guidance, and the finalization plan so
approval and finalization happen in one clean gate.

## When To Run

Run this workflow at the end of every implementation task.

## Required Completion Gate Shape

Every completion gate must include:

- `Story Explainer`
- `Current Status`
- `Testing Brief`
- `Decision / Design Brief`
- `Docs / Memory`
- `Visible Proof`
- `GitHub Status`
- `Completion Plan`
- `User Audit Checklist (Run This Now)`

For stories that touch the hosted web shell or deployment contract, the final
post-merge closeout must also include:

- `Deployed Audit Checklist (Run On Hosted Version)`

The completion gate is incomplete if any of these sections are missing.

## Story Explainer Requirements

The completion gate must include a concise explainer that tells the user:

- what happened and why this story exists
- what changed in user-facing terms and in repo terms
- the key files, routes, components, workflows, or contracts that moved
- how the user should inspect the result for themselves
- how the automated checks and manual audit steps map to the story

The explainer should read like a guided walkthrough, not a raw changelog.

For UI stories, the explainer must also include:

- the exact route, screen, modal, or component surface that changed
- the starting state or entry path the user should use
- the visible interaction or layout change they should expect
- the proof artifact to review when available: screenshot, Pencil artifact, or
  explicit blocker

For ChatBridge stories that change inspectable shell, lifecycle, history, or
HTML-preview behavior, the explainer must also include:

- whether `src/shared/chatbridge/live-seeds.ts` was updated
- whether the `/dev/chatbridge` seed lab was updated
- the exact seeded session or scenario the user should reseed and open
- the visible state that seed is proving

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

## Testing Brief Requirements

The testing brief should not only list commands. It should explain:

- which required checks were run
- which story surfaces those checks cover
- whether any failures are attributable to the current diff or are pre-existing
- what still requires manual inspection

For UI stories, explicitly separate automated coverage from visual/manual
coverage so the user can see what still needs eyes-on review.

## Visible Proof Requirements

Visible proof should point to the strongest evidence the user can inspect
without re-deriving the story from the diff.

For UI stories, prefer:

- screenshot or design artifact paths
- route or component references tied to the changed surface
- a short note on what the user should compare or notice

## Completion Plan Requirements

The completion gate must include the finalization plan in the same packet as
the user audit:

- current branch
- target base branch
- writable remote
- current GitHub state: `local-only`, `pushed-without-PR`, `open PR`, or
  `merged`
- whether the requested story is already present on the target base branch; if
  yes, treat it as the baseline and describe any remaining work as follow-up
- proposed commit message
- expected deploy status: `deployed`, `not deployed`, or `blocked`
- if the change touches the hosted web shell or deployment contract, expected
  post-merge `Vercel Main Sync` status and workflow path
- recovery path: `.ai/workflows/finalization-recovery.md`
- if unrelated WIP exists in the current worktree, the clean isolation plan
  instead of treating the dirty tree as a finish blocker

## User Audit Checklist Requirements

- focus on manual judgment, visible proof, or approval decisions
- do not offload routine terminal verification Codex could run itself
- name the exact route, click path, or state to inspect when UI changed
- include expected outcome and failure hint for each step
- align the checklist with the story explainer so the user can move directly
  from "what changed" to "how do I verify it"
- for ChatBridge stories with inspectable behavior changes, point to
  `/dev/chatbridge` and name the exact seeded session or scenario to use

## Deployed Audit Checklist Requirements

For stories that touch the hosted web shell or deployment contract, the final
post-merge closeout must include a hosted-version checklist that tells the user
exactly what to open after merge:

- include the exact hosted URL or the explicit blocker that prevents access
- name the exact route, click path, or state to inspect on the deployed version
- include the expected good outcome for each step
- include a short failure hint for each step
- call out deployment protection or login requirements when they affect access
- keep the checklist focused on deployed behavior, not local terminal commands

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
6. If the story touched the hosted web shell or deployment contract, the
   post-merge closeout must include the deployed audit checklist after the
   Vercel verification result is known.

## Exit Criteria

- story explainer clearly states what changed and how to inspect/test it
- completion evidence summarized clearly
- GitHub state and merge status made explicit so the user never has to guess
  whether work is only local, on a PR, or already merged
- finalization plan included in the same packet as the user audit
- docs and memory status explicit
- finalization default is explicit and visible in the completion gate, with
  automatic follow-through unless the user pauses it
- story completion is defined as merged-to-`main` on GitHub unless the user
  explicitly pauses or selects a different merge path
- deploy-surface stories include a deployed-version audit checklist in the
  post-merge closeout
- UI stories include route-level inspection guidance and visible proof that
  tells the user what to look for
- ChatBridge stories with inspectable behavior changes identify the updated
  live seed scenario and tell the user how to reseed/open it
