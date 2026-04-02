# CB-306 Task Breakdown

| ID | Task | Priority | Depends On | Output |
|---|---|---|---|---|
| T001 | Add the CB-306 story packet and control-doc references for the Chess-specific backfill. | must-have | no | Spec, plan, task breakdown, constitution check, status |
| T002 | Extend Chess single-app discovery to cover explicit tool/app wording and natural Chess prompt forms like raw FEN, PGN-like move lists, and “best move”. | must-have | no | Updated discovery logic and tests |
| T003 | Convert successful `chess_prepare_session` tool results into real Chess app parts with host-owned snapshots. | must-have | T002 | Reviewed launch normalization update and tests |
| T004 | Preserve the generic reviewed-launch part behavior for non-Chess apps and move the generic bridge tests onto that path. | must-have | T003 | Updated generic reviewed-launch tests |
| T005 | Add an end-to-end regression scenario proving the live tool path yields a Chess runtime part instead of the generic reviewed-launch shell. | must-have | T003 | New integration scenario with trace coverage |
| T006 | Update Pack 03 / program control docs and smoke ledger with the new backfill and its closeout evidence. | should-have | T001,T005 | Refreshed STATUS/progress/audit docs |
| T007 | Run focused and full validation, then merge the story to `main`. | must-have | T002,T003,T004,T005,T006 | Green validation and merged PR |

## Execution Notes

- Keep this story narrow to Chess. Do not absorb Drawing Kit / Weather runtime
  work here.
- Reuse the existing Chess runtime UI rather than inventing a new launch shell.
- If a design question appears that would materially change the visible Chess
  UI, stop and reopen a proper Pencil review instead of improvising in code.
