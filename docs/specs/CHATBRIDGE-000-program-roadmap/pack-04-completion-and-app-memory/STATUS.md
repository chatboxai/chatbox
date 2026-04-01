# Pack 04 Status

- Pack state: validated
- Current story: Pack 04 complete; next active story is CB-501
- Unlock rule: Pack 5 and Pack 6 stay locked until this file contains a written
  exit memo and every Pack 4 story is at least `validated`

## Story Order

1. CB-401
2. CB-402
3. CB-403
4. CB-404

## Story Ledger

| Story | State | Next requirement |
|---|---|---|
| CB-401 | validated | Structured completion payload contract is in place with happy-path and malformed-payload proof. |
| CB-402 | validated | Host-owned summary normalization now gates what app memory reaches model context. |
| CB-403 | validated | Later-turn app context now carries only host-approved summaries and fails closed on stale state. |
| CB-404 | validated | Conversation-first degraded recovery UI is implemented with reload or resume continuity proof. |

## Required Proof Set

- [x] Normal app completion and follow-up chat
- [x] Interrupted or incomplete app session
- [x] Stale active app pointer
- [x] Reload or resume continuity

## Exit Checklist

- [x] CB-401 is at least `validated`
- [x] CB-402 is at least `validated`
- [x] CB-403 is at least `validated`
- [x] CB-404 is at least `validated`
- [x] All four Pack 4 proof scenarios are linked from story status files
- [x] Pack-level exit memo is written below
- [x] `progress.md` unlocks Pack 5 and Pack 6

## Exit Memo

Pack 4 exits validated on 2026-04-01. CB-401 locked the schema-versioned
completion payload contract, CB-402 moved model-visible app memory behind
host-owned summary normalization, CB-403 injected only the selected
host-approved app context into later turns, and CB-404 implemented the approved
conversation-first degraded recovery checkpoint with persisted recovery inputs.

Linked proof set:

- normal completion and follow-up chat:
  `cb-401/status.md`, `cb-402/status.md`, and `cb-403/status.md`
- interrupted or incomplete app session:
  `cb-404/status.md`
- stale active app pointer:
  `cb-403/status.md`
- reload or resume continuity:
  `cb-404/status.md` plus
  `test/integration/chatbridge/scenarios/app-aware-persistence.test.ts`

Pack 5 and Pack 6 are now unlocked in the program ledger, with Pack 5 opening
first in the single-agent lane at CB-501.
