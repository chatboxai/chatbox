# CB-004 Task Breakdown

## Story

- Story ID: CB-004
- Story Title: Web deployment and release infrastructure baseline

## Execution Notes

- Keep the deploy contract honest to the repo's existing surfaces.
- Make Phase 0 deployment concrete without pretending the future backend
  services already exist.
- Record real deploy evidence, not just docs or scripts.

## Story Pack Alignment

- Higher-level pack objectives: Pack 0 foundation
- Planned stories in this pack: CB-000, CB-001, CB-002, CB-003, CB-004
- Why this story set is cohesive: it closes the remaining Phase 0 gap between
  deployment planning and an actual deployable surface
- Coverage check: this story advances hosted web deployment, release
  infrastructure, and deployment evidence

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Add the checked-in web-host provider config and smoke artifact contract. | must-have | no | local config review |
| T002 | Restore the missing root release/deploy wrappers referenced by `package.json`. | blocked-by:T001 | yes | command shape review |
| T003 | Publish the Pack 0 deployment and infrastructure reference docs plus env example. | blocked-by:T001,T002 | yes | doc consistency review |
| T004 | Update the Pack 0 roadmap and story tree with a dedicated deployment story. | blocked-by:T003 | yes | roadmap consistency check |
| T005 | Validate locally and create a real hosted preview deployment with recorded evidence. | blocked-by:T001,T002,T003,T004 | no | local smoke + provider URL evidence |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
- [x] The repo contains a checked-in web-host config and a smoke path
- T002 tests:
- [x] Every root release/deploy script referenced by `package.json` exists
- T003 tests:
- [x] Pack 0 docs and `.env.example` match the actual deploy/release contract
- T004 tests:
- [x] The roadmap treats deployment as a real Phase 0 deliverable
- T005 tests:
- [x] There is real deploy evidence, not just local file changes

## Completion Criteria

- [x] All must-have tasks complete
- [x] Acceptance criteria mapped to completed tasks
- [x] Deferred tasks documented with rationale
- [x] A real preview deployment URL is recorded in the story evidence

## Recorded Evidence

- Project: `chatbox-web`
- Deployment ID: `dpl_2XcjSGjddrYDf8XgEnRoN2fUPBMt`
- Preview URL:
  `https://chatbox-3ev0v910o-thisisyoussefs-projects.vercel.app`
- Inspector URL:
  `https://vercel.com/thisisyoussefs-projects/chatbox-web/2XcjSGjddrYDf8XgEnRoN2fUPBMt`
- Status:
  `Ready` on 2026-03-31
- Verification notes:
  - local `/healthz.json` smoke passed
  - hosted preview is real and ready
  - anonymous HTTP access is still blocked by Vercel team authentication
    policy

## Deferred Follow-up

- Decide whether Phase 0 should keep Vercel deployment protection enabled for
  the hosted shell or add a separate public testing surface later.
- Reduce or bypass the legacy `zipfile` native install noise in hosted web
  installs so preview logs are cleaner and less misleading.
