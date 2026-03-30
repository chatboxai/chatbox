# Finalization Recovery Workflow

**Purpose**: Recover deliberately when git finalization fails instead of
treating partial git state as task completion.

## When To Run

Run this when any of the following happen during
`.ai/workflows/git-finalization.md`:

- base-branch sync or merge hits a conflict
- push or PR creation fails
- validation fails after staging
- the dirty worktree cannot be isolated safely
- a PR merge fails because of conflicts or required-check issues

## Step 1: Capture Failure State

Record:

- failure step
- exact command that failed
- key error output
- whether the branch is still clean or in the middle of a merge/rebase

## Step 2: Restore a Safe Git State

If a merge is in progress:

```bash
git merge --abort
```

If a rebase is in progress:

```bash
git rebase --abort
```

If neither is active, do not improvise destructive cleanup.

## Step 3: Classify the Failure

- `sync failure`
- `merge conflict`
- `push or PR failure`
- `validation failure`
- `shared-tree isolation failure`
- `merge failure`

## Step 4: Choose the Recovery Path

- `sync failure`: restore network or remote access, then re-run finalization
- `merge conflict`: re-sync the base branch, resolve conflicts carefully, then
  re-run the completion gate if the diff changed materially
- `push or PR failure`: restore authentication or remote permissions, then
  continue from finalization
- `validation failure`: fix the branch hygiene or validation issue, then re-run
  the completion gate if the diff changed materially
- `shared-tree isolation failure`: move the story onto a clean branch/worktree
  or get ownership clarification for overlapping files, then re-run the
  completion gate
- `merge failure`: address check failures or branch drift, then return to the
  completion gate before another merge attempt

## Step 5: Return to the Completion Gate

Do not silently continue finalization after a failure.
Return to `.ai/workflows/story-handoff.md` with:

- what failed
- what was recovered
- what still blocks completion

## Exit Criteria

- failure cause recorded
- git state restored safely
- recovery path chosen explicitly
