# Vercel Post-Merge Verification Workflow

**Purpose**: Treat the hosted web shell as a real post-merge deployment surface
instead of assuming merge-to-`main` is the final operational checkpoint.

## When To Run

Run this workflow after a merge to `main` when:

- the repo change touches the hosted web shell,
- the change touches `vercel.json`, `.github/workflows/`, or deployment
  scripts/docs, or
- the story explicitly changes the deployment or release contract.

The repo now also has an automatic mainline hook:
`.github/workflows/vercel-main-sync.yml`.

## Automation Contract

- Trigger: `push` to `main`
- Deployment surface: hosted web shell only
- Deploy command: `bash scripts/deploy-vercel-production.sh`
- Verification command:
  `bash scripts/verify-vercel-deployment.sh <deployment-url> production <commit-sha>`
- Required secret: `VERCEL_TOKEN`
- Project link source: `.vercel/project.json`
- Duplicate-deploy guard: `vercel.json` disables Vercel Git auto-deploy for
  `main` through `git.deploymentEnabled.main = false`

## Verification Phase

The verification phase must use the Vercel CLI directly:

1. Wait for the deployment to complete:
   `vercel inspect <deployment-url> --wait --timeout 10m`
2. Print build logs:
   `vercel inspect <deployment-url> --logs --wait --timeout 10m`
3. Assert the hosted shell is serving the smoke payload:
   `vercel curl /healthz.json --deployment <deployment-url>`
4. Confirm the payload is the expected web build and, when available, that the
   reported `commitSha` matches the merged commit.

## Post-Merge User Closeout

After the workflow result is known, return a concise post-merge update that
includes:

- merged commit SHA
- PR URL
- `Vercel Main Sync` workflow URL and status
- deployment URL when available, or the explicit blocker if not
- `Deployed Audit Checklist (Run On Hosted Version)`

The deployed audit checklist should tell the user:

1. the exact hosted URL to open
2. the exact route, click path, or page state to inspect
3. the expected good outcome
4. the likely failure hint if the check does not pass
5. any auth or deployment-protection requirement that affects access

## Story Completion Rule

- Merge to `main` is required, but it is not the last operational check for
  deploy-surface stories.
- For stories covered by this workflow, completion is:
  - PR merged to `main`
  - `Vercel Main Sync` workflow passed
  - hosted verification payload matched the merged commit or an explicit
    blocker was recorded

## Failure Handling

- If deploy fails, route to `.ai/workflows/finalization-recovery.md`.
- If verification fails, treat it as a post-merge release incident for the
  hosted web shell:
  - capture the failed workflow URL
  - record the deployment URL or absence of one
  - keep the story state explicit as `merged-but-deploy-failed`
  - fix forward or revert with a follow-up story/PR
- Even on failure, provide a deployed audit checklist or an explicit reason the
  user cannot run one yet.

## Exit Criteria

- automatic mainline deploy hook exists
- verification uses the Vercel CLI, not only raw HTTP checks
- the post-merge verification result is explicit in the completion/update path
- deploy-surface closeout tells the user what to inspect on the hosted version
