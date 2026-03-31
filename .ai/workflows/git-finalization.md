# Git Finalization Workflow

**Purpose**: Execute commit, push, PR, merge, and cleanup atomically after the
combined completion gate, unless the user explicitly pauses or requests a
different merge path.

For this workspace, a story is not considered complete until this workflow
reaches a successful GitHub merge to `main`, unless the user explicitly pauses
before merge or requests a different merge path.

## When To Run

Run this workflow only after:

- implementation and validation are done
- `.ai/workflows/story-handoff.md` has been issued
- the user has not explicitly paused finalization or requested a different
  merge path

This workflow is execution-only. The user-facing review already happened in the
combined completion gate.
Do not treat "validation passed, but I left unrelated in-progress changes
untouched so I did not stage, commit, or merge" as a successful stop state.
Finalization owns finding the safest clean isolation path and carrying the
story to merge.

## Step 1: Confirm Readiness

Before final git actions:

- confirm the active branch matches the current story
- confirm the completion gate already recorded the story explainer, deploy
  status, and finalization plan
- confirm the user has not explicitly paused finalization or requested a
  different merge path

If any of these are false, stop and return to
`.ai/workflows/story-handoff.md`.

## Step 2: Sync With Remotes

```bash
git fetch --all --prune
git status -sb
git branch -vv
```

## Step 3: Isolate the Story Diff If Needed

If the worktree contains unrelated changes:

- do not reset or discard them
- do not stop at local validation
- prefer a clean worktree or fresh `codex/` branch from the latest base branch
  for finalization
- replay only the story-owned diff there using the safest available path
- re-run the required validation commands on the isolated story diff before
  staging
- continue the rest of finalization from that isolated branch/worktree

If file ownership or overlapping hunks are ambiguous, stop and route to
`.ai/workflows/finalization-recovery.md`.

## Step 4: Review, Stage, and Commit

```bash
git status --short
git diff
git add <story-owned-files>
git commit -m "<message>"
```

Stage only the story-owned files or hunks.

If staging or commit fails, stop and route to
`.ai/workflows/finalization-recovery.md`.

## Step 5: Push and Open or Update the PR

```bash
git push
gh pr status
```

If no PR exists:

```bash
gh pr create --fill
```

If a PR already exists, update it as needed and confirm the correct base
branch.

If push or PR creation fails, stop and route to
`.ai/workflows/finalization-recovery.md`.

Before leaving this step, record the exact GitHub state:

- branch pushed or not
- PR URL or `no PR`
- PR open/closed/merged state
- whether the work is merged to the target base branch yet

## Step 6: Run Final Validation

Use the repo validation commands captured in the completion gate plus
`git diff --check`.

If it fails, stop and route to `.ai/workflows/finalization-recovery.md`.

## Step 7: Merge With Visible PR Lineage

After the combined completion gate is issued, no pause is requested, and checks
are passing, merge with a normal merge commit by default:

```bash
gh pr merge --merge --delete-branch
```

Use squash or rebase only when the user explicitly asks for it.

If merge fails or GitHub reports conflicts/check failures, stop and route to
`.ai/workflows/finalization-recovery.md`.

## Step 8: Run Post-Merge Deploy Verification When Required

If the story touched the hosted web shell or deployment contract:

- run `.ai/workflows/vercel-post-merge-verification.md`
- watch the `Vercel Main Sync` workflow for the merged `main` commit
- treat a failed deploy or failed verification as a post-merge release problem,
  not as invisible background noise
- record the workflow result in the finalization outcome

If the story did not touch that surface, record `not applicable` and continue.

## Step 9: Refresh Local Refs and Cleanup

```bash
git fetch --all --prune
git switch main
git pull --ff-only origin main
git branch -d <story-branch>
```

If the branch must remain temporarily, record why instead of deleting it
silently.

## Step 10: Report Finalization Outcome

Return a concise update with:

- branch name
- commit SHA
- target remote
- PR URL/status
- merge status
- post-merge Vercel verification status: `passed`, `failed`, or `not applicable`
- explicit GitHub state: `local-only`, `pushed-without-PR`, `open PR`, or
  `merged`
- branch cleanup status
- finalization guard result

If the story touched the hosted web shell or deployment contract, also include:

- workflow URL for `Vercel Main Sync`
- deployment URL when available, or the explicit blocker if not
- `Deployed Audit Checklist (Run On Hosted Version)`

## Exit Criteria

- combined completion gate issued with no pause or alternate merge-path request
  in effect
- no user pause or alternate merge-path request is in effect
- shared-worktree ambiguity resolved by safe isolation or routed to recovery
- changes committed
- changes pushed to a writable remote
- PR created or updated
- validation plus `git diff --check` passed
- merge completed or failure routed to recovery
- post-merge Vercel verification handled or explicitly marked `not applicable`
- branch cleanup completed or explicitly deferred
- deploy-surface finalization includes a hosted-version audit checklist
