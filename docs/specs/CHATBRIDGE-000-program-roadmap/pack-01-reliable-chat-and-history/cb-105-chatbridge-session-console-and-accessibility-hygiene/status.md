# CB-105 Status

- status: planned
- pack: Pack 01 - Reliable Chat and History
- single-agent order: backfill 9 of 9
- blocked by: CB-507
- unblocks: queue complete
- implementation surfaces:
  - `src/renderer/components/common/Avatar.tsx`
  - `src/renderer/components/chat/Message.tsx`
  - shell or route focus-management surfaces implicated by smoke logs
- validation surfaces:
  - smoke console logs
  - targeted component/shell tests
- happy-path scenario proof:
  - planned: seeded ChatBridge sessions render without the confirmed warnings
- failure or degraded proof:
  - planned: focus-management regressions remain covered after the fix
- acceptance-criteria status:
  - AC-1 planned
  - AC-2 planned
  - AC-3 planned
- notes:
  - Opened from `smoke-audit-master.md` finding SA-007.
  - This story should stay last in the queue so it cleans up after the larger
    runtime rebuilds rather than fighting churn midstream.
  - `CB-605` is legacy and should not block the active rebuild queue.
