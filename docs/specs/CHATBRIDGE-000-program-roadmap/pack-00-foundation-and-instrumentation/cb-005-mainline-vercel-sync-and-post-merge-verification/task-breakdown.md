# CB-005 Task Breakdown

## Story

- Story ID: CB-005
- Story Title: Mainline Vercel sync and post-merge verification

## Execution Notes

- Keep the automation grounded in the existing hosted web shell.
- Make the post-merge verification phase visible in both CI and harness docs.
- Avoid duplicate production deploys from overlapping provider automation.

## Story Pack Alignment

- Higher-level pack objectives: Pack 0 foundation
- Planned stories in this pack: CB-000, CB-001, CB-002, CB-003, CB-004,
  CB-005
- Why this story set is cohesive: it turns Phase 0 deployment from a manual
  proof into an automated, monitored mainline contract
- Coverage check: this story advances deployment automation, post-merge
  verification, and operational completion evidence

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Add checked-in deploy and verify scripts for the hosted Vercel shell. | must-have | no | script review |
| T002 | Add the `push main` GitHub Actions workflow that deploys and then verifies with the Vercel CLI. | blocked-by:T001 | no | workflow review |
| T003 | Disable duplicate `main` deploys from Vercel Git config. | blocked-by:T002 | yes | `vercel.json` review |
| T004 | Update Pack 0 and harness docs so post-merge Vercel verification is part of the completion path. | blocked-by:T001,T002,T003 | yes | doc consistency review |
| T005 | Validate the changed surface and record the secret/project-link contract. | blocked-by:T001,T002,T003,T004 | no | root validation + contract check |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
- [ ] deploy script builds and returns a deployment URL
- [ ] verify script fails on invalid smoke payloads
- T002 tests:
- [ ] `push` to `main` defines separate deploy and verify jobs
- T003 tests:
- [ ] `vercel.json` prevents duplicate `main` deploys from Vercel Git
- T004 tests:
- [ ] completion and deployment docs mention the post-merge verification phase
- T005 tests:
- [ ] required secret and project-link assumptions are explicit

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Deferred tasks documented with rationale
- [ ] Mainline deploy automation and verification are fully checked in

## Recorded Evidence

- Workflow path: `.github/workflows/vercel-main-sync.yml`
- Deploy script: `scripts/deploy-vercel-production.sh`
- Verify script: `scripts/verify-vercel-deployment.sh`
- Duplicate deploy guard: `vercel.json`

## Deferred Follow-up

- Add preview-branch verification if the repo later wants protected PR preview
  testing in CI.
