# Pack 03 Status

- Control state: Pack 03 backfills validated; reviewed-app bridge launch seam and Chess runtime handoff restored
- Single-agent scope: execute bridge-runtime backfill `CB-305` third, after
  `CB-006` and `CB-007`, then close the urgent Chess runtime handoff backfill
  `CB-306` before later live multi-app repairs
- Story state model: `planned`, `in_progress`, `code_complete`, `validated`, `merged`

## Story Ledger

| Story | State | Notes |
|---|---|---|
| CB-300 | merged | User-reported as done before the single-agent rollout begins. |
| CB-301 | merged | User-reported as done before the single-agent rollout begins. |
| CB-302 | merged | User-reported as done before the single-agent rollout begins. |
| CB-303 | merged | User-reported as done before the single-agent rollout begins. |
| CB-304 | merged | User-reported as done before the single-agent rollout begins. |
| CB-305 | validated | Reviewed host-tool launches now become real bridge-backed app parts, and artifact preview remains on the separate HTML-preview seam. |
| CB-306 | validated | Explicit and natural Chess launch requests now normalize into real Chess runtime parts instead of the generic reviewed-launch shell, and invalid launch input fails closed. |

## Monitoring Notes

- Pack 03 was reopened by `smoke-audit-master.md` finding SA-005.
- `CB-305` closed the bridge-host-controller adoption seam with traced
  happy-path and degraded proof under `chatbox-chatbridge`.
- `CB-306` closed the exact Chess regression where an explicit reviewed Chess
  launch rendered the generic reviewed-launch shell and could time out before a
  real board was ever shown.
- Pack 03 is no longer the blocking seam for later runtime stories; the active
  unresolved work now sits back in Pack 05.
