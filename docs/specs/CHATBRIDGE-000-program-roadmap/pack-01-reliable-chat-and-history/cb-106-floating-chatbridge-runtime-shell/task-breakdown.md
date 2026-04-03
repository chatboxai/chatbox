# CB-106 Task Breakdown

| ID | Task | Priority | Depends On | Output |
|---|---|---|---|---|
| T001 | Add the CB-106 story packet and control-doc references for the Pack 01 shell backfill. | must-have | no | Spec, plan, task breakdown, constitution check, status |
| T002 | Produce approved Pencil variations for a floating session-level app shell plus compact message anchor. | must-have | T001 | `CB-106.pen`, screenshots, `pencil-review.md`, approved variation |
| T003 | Add session-level selection state for which ChatBridge app instance is floated and whether it is minimized. | must-have | T002 | Store/selector changes and tests |
| T004 | Introduce a route-level floating ChatBridge runtime host that renders the active app near the composer. | must-have | T003 | New runtime host component and session-route integration |
| T005 | Refactor message-level app rendering so active app parts collapse into compact anchors while preserving durable message history. | must-have | T004 | Updated ChatBridge message rendering and tests |
| T006 | Add responsive behavior for desktop dock versus small-screen/mobile bottom-sheet presentation. | must-have | T004 | Responsive shell behavior and accessibility coverage |
| T007 | Add regression scenarios for continued chat while an app remains visible, plus minimize/restore and degraded fallback behavior. | must-have | T004,T005,T006 | New focused tests and smoke evidence |
| T008 | Refresh Pack 01 / program control docs and seeded examples if required by the visible behavior change. | should-have | T001,T007 | Updated STATUS/progress docs and seeded data decision |
| T009 | Run focused and full validation, then merge the story to `main`. | must-have | T003,T004,T005,T006,T007,T008 | Green validation and merged PR |

## Execution Notes

- Keep this story at the shell/runtime-host layer. Do not fold Drawing Kit or
  Weather runtime implementation into it.
- Prefer a docked host surface over a draggable freeform window.
- Preserve the message `app` part as the durable source-of-truth artifact even
  when the live viewport is floated elsewhere in the session UI.
