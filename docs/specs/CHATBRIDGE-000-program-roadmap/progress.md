# ChatBridge Program Progress

This file is the operational control layer for the post-Pack-4 single-agent
rollout. The canonical program structure remains `CHATBRIDGE-000`; this file
tracks execution order, pack gates, and objective proof without replacing the
existing packs.

## State Model

Use only these story states:

- `planned`
- `in_progress`
- `code_complete`
- `validated`
- `merged`

Validation requires linked code paths, linked test paths, at least one
happy-path scenario proof, and at least one degraded or failure-path proof when
the story changes routing, auth, lifecycle, or recovery behavior.

## Operating Defaults

- Begin this rollout only after Pack 4 has a written exit memo and linked proof.
- Keep exactly one story in progress at a time.
- Historical Pack 05 through Pack 07 closeout remains documented, but any smoke
  audit finding reopens the queue through backfill stories in the owning pack.
- If a later pack exposes a missing prerequisite, add a backfill story to the
  original pack instead of patching around it in the later pack.
- Stabilize ChatBridge runtime work into these boundaries as code lands:
  - `src/shared/chatbridge/`
  - `src/renderer/packages/chatbridge/`
  - `src/main/chatbridge/`

## Pack Ledger

| Pack | Control state | Story posture | Exit memo | Notes |
|---|---|---|---|---|
| Pack 00 | reopened by smoke audit | `CB-006` planned backfill | inherited baseline | SA-006 reopened observability and manual-smoke coverage as the first rebuild story. |
| Pack 01 | reopened by smoke audit | `CB-105` planned backfill | inherited baseline | SA-007 reopened console and accessibility hygiene as the final cleanup story. |
| Pack 02 | historical baseline | inherited `merged` baseline | inherited | Contracts and bridge foundations are assumed ready for post-Pack-4 execution. |
| Pack 03 | reopened by smoke audit | `CB-305` planned backfill | inherited baseline | SA-005 reopened the real reviewed-app bridge launch seam. |
| Pack 04 | validated | CB-401 through CB-404 validated | written | Exit proof is recorded in `pack-04.../STATUS.md`; Pack 5 and Pack 6 are unlocked. |
| Pack 05 | reopened by smoke audit | `CB-505` through `CB-507` planned backfills | historical exit memo | SA-001 through SA-003 showed that the live multi-app runtime still falls short of the validated baseline proof. |
| Pack 06 | reopened by smoke audit | `CB-605` planned backfill | historical exit memo | SA-004 showed Story Builder auth/resource flows are not yet honest in live runtime. |
| Pack 07 | validated | CB-701, CB-703, CB-705, CB-702, and CB-704 validated | written | Pack 07 exit is complete; the full-program convergence audit is now validated on this branch via `test/integration/chatbridge/scenarios/full-program-convergence.test.ts`. |

## Single-Agent Queue

1. Pack 00 -> CB-006
2. Pack 03 -> CB-305
3. Pack 05 -> CB-505
4. Pack 05 -> CB-506
5. Pack 05 -> CB-507
6. Pack 06 -> CB-605
7. Pack 01 -> CB-105

## Current Milestone

- Active next gate: smoke-audit rebuild queue begins at `CB-006`
- Status: reopened by `smoke-audit-master.md`
- Result: historical pack closeout remains documented, but live-runtime smoke
  findings now govern current execution order until the rebuild queue is empty

## Pack 4 Exit Lock

Pack 4 must prove all of the following before Pack 5 opens:

- explicit completion payloads
- host-owned summary normalization
- later-turn app-context injection
- degraded completion and recovery UX

Required Pack 4 proof set:

- [x] normal app completion and follow-up chat
- [x] interrupted or incomplete app session
- [x] stale active app pointer
- [x] reload or resume continuity

## Objective Proof Matrix

| Objective | Primary proving packs | Current proof state | Representative proof |
|---|---|---|---|
| O1 continuous in-thread app UX | Packs 01, 03, 04, 05, 06 | reopened by smoke audit | `smoke-audit-master.md` findings SA-001, SA-002, SA-003, SA-005 |
| O2 host-owned lifecycle, routing, and memory | Packs 02, 04, 05, 06 | reopened by smoke audit | `smoke-audit-master.md` findings SA-002, SA-004, SA-005 |
| O3 reviewed-partner trust and governance | Packs 02, 05, 07 | reopened by smoke audit | `smoke-audit-master.md` findings SA-001, SA-002, SA-003 |
| O4 authenticated app support without raw credentials | Pack 06 | reopened by smoke audit | `smoke-audit-master.md` finding SA-004 |
| O5 partner-ready governable platform | Pack 07 | partially validated; observability reopen | `smoke-audit-master.md` finding SA-006 plus historical Pack 07 proof |

## Program Closeout

Historical Pack 04 through Pack 07 closeout remains checked in, but the
smoke audit has reopened the program for a focused rebuild.

- Historical closeout proof remains available in
  `test/integration/chatbridge/scenarios/full-program-convergence.test.ts` and
  `convergence-audit.md`.
- Current product verdict: not ready to re-assert as end-to-end healthy until
  the smoke-audit rebuild queue is complete.
- Backfill stories required by this audit:
  - `CB-006`
  - `CB-305`
  - `CB-505`
  - `CB-506`
  - `CB-507`
  - `CB-605`
  - `CB-105`
- Repo-wide validation note: the repo gate can be green while the live
  ChatBridge runtime still falls short; use this file and `smoke-audit-master.md`
  as the current truth for rebuild work.

## Required Scenario Families

Keep representative proof under `test/integration/chatbridge/` for:

- app eligibility resolution
- route / clarify / refuse
- single-app and multi-app continuity
- completion and post-completion follow-up
- auth request, approval, denial, expiry, and resume
- malformed bridge traffic and replay rejection
- timeout, crash, and degraded recovery
- policy denial and version kill-switch behavior
- partner validator and harness compatibility checks
