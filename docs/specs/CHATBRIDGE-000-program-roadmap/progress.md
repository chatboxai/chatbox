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
| Pack 00 | validated backfills complete | `CB-006` and `CB-007` validated | inherited baseline | SA-006 is closed by `CB-006`, and the delta-pass evidence-quality follow-up is closed by `CB-007` before runtime rebuild work continues. |
| Pack 01 | validated backfills complete | `CB-106` merged; `CB-105` validated backfill | inherited baseline | SA-007 is closed by `CB-105`, and the approved split-tray shell plus the final hygiene pass now leave Pack 01 complete for the active rebuild queue. |
| Pack 02 | historical baseline | inherited `merged` baseline | inherited | Contracts and bridge foundations are assumed ready for post-Pack-4 execution. |
| Pack 03 | validated backfills complete | `CB-305` and `CB-306` validated backfills | inherited baseline | SA-005 is closed by CB-305, and the urgent Chess runtime handoff regression is closed by CB-306; reviewed host-tool launches now flow through the bridge host controller and successful Chess launches become real Chess runtime parts. |
| Pack 04 | validated | CB-401 through CB-404 validated | written | Exit proof is recorded in `pack-04.../STATUS.md`; Pack 5 and Pack 6 are unlocked. |
| Pack 05 | validated backfills complete | `CB-508`, `CB-506`, `CB-509`, `CB-510`, and `CB-507` validated | historical exit memo | Default reviewed catalog, seed inspection, live invoke, Drawing Kit, Weather, and live clarify/refuse route receipts now align around the active flagship set. |
| Pack 06 | historical baseline with legacy parked follow-up | `CB-605` planned legacy packet | historical exit memo | Story Builder auth/resource proof remains a legacy reference and is no longer on the active queue. |
| Pack 07 | validated | CB-701, CB-703, CB-705, CB-702, and CB-704 validated | written | Pack 07 exit is complete; the full-program convergence audit is now validated on this branch via `test/integration/chatbridge/scenarios/full-program-convergence.test.ts`. |

## Active Single-Agent Queue

Treat this list as the only execution order for the reopened rebuild lane. If a
story is not listed here, it is either historical baseline or a parked legacy
packet and should not be picked up next.

1. Pack 00 -> `CB-006`
2. Pack 00 -> `CB-007`
3. Pack 03 -> `CB-305`
4. Pack 03 -> `CB-306`
5. Pack 05 -> `CB-508`
6. Pack 05 -> `CB-506`
7. Pack 01 -> `CB-106`
8. Pack 05 -> `CB-509`
9. Pack 05 -> `CB-510`
10. Pack 05 -> `CB-507`
11. Pack 01 -> `CB-105`

## Current Milestone

- Active next gate: none; the reopened rebuild queue is complete on this branch
- Immediate next story after `CB-105`: none unless new smoke-audit backfills
  are opened
- Status: `CB-006`, `CB-007`, `CB-305`, `CB-306`, `CB-508`, `CB-506`,
  `CB-106`, `CB-509`, `CB-510`, `CB-507`, and `CB-105` are now validated or
  merged on this branch.
- Result: the active reviewed catalog, invoke path, session-level split runtime
  shell, Drawing Kit runtime, Weather runtime/manual-smoke proof, live
  clarify/refuse route receipts, and the final Pack 01 console/accessibility
  hygiene pass now agree around the active flagship direction.

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
| O1 continuous in-thread app UX | Packs 01, 03, 04, 05 | reopened by smoke audit and catalog change | `smoke-audit-master.md` findings SA-001, SA-002, SA-003, SA-005 plus new Pack 05 app transition stories |
| O2 host-owned lifecycle, routing, and memory | Packs 02, 04, 05 | reopened by smoke audit and catalog change | `smoke-audit-master.md` findings SA-002, SA-005 plus Drawing Kit / Weather replacement work |
| O3 reviewed-partner trust and governance | Packs 02, 05, 07 | reopened by smoke audit and catalog change | `smoke-audit-master.md` findings SA-001, SA-002, SA-003 plus active catalog transition story `CB-508` |
| O4 authenticated app support without raw credentials | Pack 06 | legacy proof parked | Historical Pack 06 proof remains checked in, but Story Builder is now legacy and `CB-605` is not on the active queue. |
| O5 partner-ready governable platform | Pack 07 | observability backfill revalidated; runtime rebuild remains open | `smoke-audit-master.md` finding SA-006 closed by CB-006, evidence-quality follow-on closed by CB-007, plus historical Pack 07 proof |

## Program Closeout

Historical Pack 04 through Pack 07 closeout remains checked in, but the
smoke audit has reopened the program for a focused rebuild.

- Historical closeout proof remains available in
  `test/integration/chatbridge/scenarios/full-program-convergence.test.ts` and
  `convergence-audit.md`.
- Current product verdict: not ready to re-assert as end-to-end healthy until
  the smoke-audit rebuild queue is complete.
- Backfill stories required by this audit:
  - `CB-006` validated
  - `CB-007` validated
  - `CB-305` validated
  - `CB-306` validated
  - `CB-508` validated
  - `CB-506` validated
  - `CB-509` validated
  - `CB-510` validated
  - `CB-507` validated
  - `CB-105` validated
- Legacy parked packets retained for reference:
  - `CB-505`
  - `CB-605`
- Repo-wide validation note: the repo gate can be green while the live
  ChatBridge runtime still falls short; use this file and `smoke-audit-master.md`
  as the current truth for rebuild work.

## Post-Queue Initiative

If the active rebuild queue closes and the team wants to continue toward a
Ghostfolio-style agent architecture, the next initiative packet is:

- `docs/specs/CHATBRIDGE-001-post-rebuild-agent-productization/`

Execution has now started there through the first bounded validated story:

- `I001-01` Renderer execution governor entrypoint and reviewed-route adoption

That packet intentionally prioritizes:

1. unified execution governor
2. backend-authoritative state and reconciliation
3. operator/admin/feedback productization
4. architecture and runtime truth sync

And intentionally defers to the end:

5. policy and refusal layer
6. verification, confidence, and provenance layer
7. high-risk action workflow

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
