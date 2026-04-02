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
- Run one pack at a time after Pack 4: Pack 5, then Pack 6, then Pack 7.
- If a later pack exposes a missing prerequisite, add a backfill story to the
  original pack instead of patching around it in the later pack.
- Stabilize ChatBridge runtime work into these boundaries as code lands:
  - `src/shared/chatbridge/`
  - `src/renderer/packages/chatbridge/`
  - `src/main/chatbridge/`

## Pack Ledger

| Pack | Control state | Story posture | Exit memo | Notes |
|---|---|---|---|---|
| Pack 00 | historical baseline | inherited `merged` baseline | inherited | No retro-audit in this rollout; backfill only if a later pack exposes a gap. |
| Pack 01 | historical baseline | inherited `merged` baseline | inherited | Treat as an accepted prerequisite to Pack 02 and later work. |
| Pack 02 | historical baseline | inherited `merged` baseline | inherited | Contracts and bridge foundations are assumed ready for post-Pack-4 execution. |
| Pack 03 | historical baseline | inherited `merged` baseline | inherited | Chess lifecycle baseline is assumed ready for Pack 4 exit work. |
| Pack 04 | validated | CB-401 through CB-404 validated | written | Exit proof is recorded in `pack-04.../STATUS.md`; Pack 5 and Pack 6 are unlocked. |
| Pack 05 | validated | CB-501 through CB-504 validated | written | Eligibility, routing, Debate Arena, and bounded multi-app continuity are proven. |
| Pack 06 | validated | CB-601 through CB-604 validated | written | Story Builder now proves host-owned auth, save/resume continuity, and completion handoff on top of the validated Pack 6 seams. |
| Pack 07 | in_progress | CB-701 and CB-703 validated; continue with CB-705 next | pending | Policy precedence plus privacy-aware audit are now explicit; platform-wide recovery is the next single-agent story. |

## Single-Agent Queue

1. Pack 04 -> CB-401
2. Pack 04 -> CB-402
3. Pack 04 -> CB-403
4. Pack 04 -> CB-404
5. Pack 05 -> CB-501
6. Pack 05 -> CB-502
7. Pack 05 -> CB-503
8. Pack 05 -> CB-504
9. Pack 06 -> CB-601
10. Pack 06 -> CB-602
11. Pack 06 -> CB-604
12. Pack 06 -> CB-603
13. Pack 07 -> CB-701
14. Pack 07 -> CB-703
15. Pack 07 -> CB-705
16. Pack 07 -> CB-702
17. Pack 07 -> CB-704

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

| Objective | Primary proving packs | Current proof state | Evidence still required |
|---|---|---|---|
| O1 continuous in-thread app UX | Packs 01, 03, 04, 05 | partial | Pack 6 authenticated-app proof and final convergence scenarios |
| O2 host-owned lifecycle, routing, and memory | Packs 02, 04, 05, 06 | strong partial | Final convergence audit across Chess, Debate Arena, and Story Builder |
| O3 reviewed-partner trust and governance | Packs 02, 05, 07 | strong partial | kill-switch proof and final convergence audit |
| O4 authenticated app support without raw credentials | Pack 06 | validated | Final convergence audit only |
| O5 partner-ready governable platform | Pack 07 | partial | recovery model, operator controls, validator/harness, final audited proof set |

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
