# Pack 01 Status

- Control state: validated backfills complete
- Single-agent scope: Pack 01 reopened for `CB-106` and the final hygiene pass
  `CB-105`; the active Pack 01 queue is now complete on this branch
- Story state model: `planned`, `in_progress`, `code_complete`, `validated`, `merged`

## Story Ledger

| Story | State | Notes |
|---|---|---|
| CB-101 | merged | Historical prerequisite assumed satisfied before Pack 02; not retro-audited by this control layer. |
| CB-102 | merged | Historical prerequisite assumed satisfied before Pack 02; not retro-audited by this control layer. |
| CB-103 | merged | Historical prerequisite assumed satisfied before Pack 02; not retro-audited by this control layer. |
| CB-104 | merged | Historical prerequisite assumed satisfied before Pack 02; not retro-audited by this control layer. |
| CB-106 | merged | User-directed Pack 01 backfill landed the approved split-tray shell so the active runtime stays visible outside scrollback while the thread keeps a compact anchor. |
| CB-105 | validated | `sessionType` prop leaks and focused `aria-hidden` shell-close warnings are covered by targeted renderer regression tests. |

## Monitoring Notes

- Pack 01 was reopened by `smoke-audit-master.md` finding SA-007.
- `CB-106` is a user-directed shell evolution layered on top of the historical
  Pack 01 baseline and should land before more Pack 05 runtime UI work.
- `CB-105` closes SA-007 by filtering the leaked `sessionType` prop at the
  avatar seam and releasing focus before sidebar/thread-history drawers hide
  their subtree.
- No direct seeded-example refresh in `src/renderer/packages/initial_data.ts`
  was required because CB-105 does not change seeded ChatBridge behavior.
