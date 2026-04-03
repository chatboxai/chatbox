# CB-105 Status

- status: validated
- pack: Pack 01 - Reliable Chat and History
- single-agent order: backfill 9 of 9
- blocked by: CB-507
- unblocks: queue complete
- implementation surfaces:
  - `src/renderer/components/common/Avatar.tsx`
  - `src/renderer/components/common/overlay-focus.ts`
  - `src/renderer/Sidebar.tsx`
  - `src/renderer/components/session/ThreadHistoryDrawer.tsx`
- validation surfaces:
  - `src/renderer/components/common/Avatar.test.tsx`
  - `src/renderer/components/common/overlay-focus.test.tsx`
  - `src/renderer/Sidebar.test.tsx`
  - `src/renderer/components/session/ThreadHistoryDrawer.test.tsx`
  - `src/renderer/components/chat/Message.chatbridge.test.tsx`
  - repo gates:
    - `pnpm test`
    - `pnpm check`
    - `pnpm lint`
    - `pnpm build`
    - `git diff --check`
- happy-path scenario proof:
  - `src/renderer/components/common/Avatar.test.tsx`
  - `src/renderer/Sidebar.test.tsx`
- failure or degraded proof:
  - `src/renderer/components/common/overlay-focus.test.tsx`
  - `src/renderer/components/session/ThreadHistoryDrawer.test.tsx`
- acceptance-criteria status:
  - AC-1 satisfied via `SystemAvatar` prop filtering in
    `src/renderer/components/common/Avatar.tsx` and
    `src/renderer/components/common/Avatar.test.tsx`.
  - AC-2 satisfied via close-time focus release in
    `src/renderer/components/common/overlay-focus.ts`,
    `src/renderer/Sidebar.tsx`, and
    `src/renderer/components/session/ThreadHistoryDrawer.tsx`.
  - AC-3 satisfied via targeted regression coverage in
    `Avatar.test.tsx`, `overlay-focus.test.tsx`, `Sidebar.test.tsx`, and
    `ThreadHistoryDrawer.test.tsx`, with the adjacent `Message.chatbridge`
    path rechecked in the focused green run.
- notes:
  - Opened from `smoke-audit-master.md` finding SA-007.
  - Focused TDD handoff state is recorded in
    `.ai/state/tdd-handoff/CB-105/pipeline-status.json`.
  - Full repo validation passed with `pnpm test`, `pnpm check`, `pnpm lint`,
    `pnpm build`, and `git diff --check`.
  - No direct `src/renderer/packages/initial_data.ts` edit was required because
    CB-105 only cleans renderer shell and console hygiene; it does not change
    the seeded ChatBridge fixture corpus.
  - `CB-605` is legacy and should not block the active rebuild queue.
