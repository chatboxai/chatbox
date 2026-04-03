# CB-510 Status

- status: validated
- pack: Pack 05 - Multi-App Routing and Debate Arena
- single-agent order: backfill 7 of 9
- blocked by: CB-509
- unblocks: CB-507
- implementation surfaces:
  - `src/shared/chatbridge/`
  - `src/main/chatbridge/`
  - `src/renderer/components/chatbridge/apps/`
  - `src/renderer/packages/chatbridge/`
  - `design/stories/`
  - `test/integration/chatbridge/scenarios/`
- validation surfaces:
  - `src/shared/chatbridge/apps/weather-dashboard.test.ts`
  - `src/main/chatbridge/weather/index.test.ts`
  - `src/renderer/components/chatbridge/apps/ReviewedAppLaunchSurface.test.tsx`
  - `src/shared/chatbridge/live-seeds.test.ts`
  - `src/renderer/packages/initial_data.test.ts`
  - `src/renderer/setup/preset_sessions.test.ts`
  - `src/renderer/dev/chatbridgeManualSmoke.test.ts`
  - `src/renderer/packages/chatbridge/reviewed-app-launch.test.ts`
  - `src/renderer/packages/chatbridge/single-app-tools.test.ts`
  - `test/integration/chatbridge/scenarios/live-reviewed-app-invocation.test.ts`
  - `test/integration/chatbridge/scenarios/weather-dashboard-flagship.test.ts`
  - LangSmith project `chatbox-chatbridge`
  - repo gates:
    - `pnpm test`
    - `pnpm check`
    - `pnpm lint`
    - `pnpm build`
    - `git diff --check`
- happy-path scenario proof:
  - `test/integration/chatbridge/scenarios/weather-dashboard-flagship.test.ts`
  - representative trace proof:
    - `chatbridge.eval.chatbridge-weather-dashboard-flagship.cb-510-doc-proof-follow-up`
      -> `8643edea-e549-4438-82ac-3e5db49d0314`
    - `chatbridge.manual_smoke.chatbridge-weather-dashboard.cb-510-doc-proof`
      -> `565aeb0a-522f-48df-ad93-b4a6737e3cdf`
- failure or degraded proof:
  - `src/main/chatbridge/weather/index.test.ts`
  - `test/integration/chatbridge/scenarios/weather-dashboard-flagship.test.ts`
  - representative trace proof:
    - `chatbridge.eval.chatbridge-weather-dashboard-flagship.cb-510-doc-proof-recovery`
      -> `51c19c3d-e03d-4ca0-b4a3-6dad545b2823`
- acceptance-criteria status:
  - AC-1 satisfied via the active reviewed catalog, preserved weather launch
    contract, and the dedicated Weather Dashboard runtime mounted through
    `ReviewedAppLaunchSurface`.
  - AC-2 satisfied via the host-owned weather IPC boundary in
    `src/main/chatbridge/weather/index.ts`, the normalized shared weather
    snapshot contract, and the renderer refresh path that never gives the app
    raw upstream access.
  - AC-3 satisfied via the inline weather dashboard states, stale/degraded
    fallback snapshots, supported desktop manual-smoke fixture, and later-turn
    host-owned summary continuity proven in
    `weather-dashboard-flagship.test.ts`.
- notes:
  - Opened from the active catalog change on 2026-04-02.
  - The checked-in repo workflow now uses the autonomous UI design pass, which
    supersedes the older Pencil-only note in the original packet.
  - Preflight and story lookup were refreshed in the isolated
    `codex/cb-510-weather-dashboard` worktree before implementation.
  - The autonomous UI design decision selected Option A, `Sky Poster`, as the
    inline weather bulletin direction before UI code landed.
  - The new supported desktop smoke path is `[Seeded] ChatBridge: Weather dashboard`,
    which traces through LangSmith and stays inside `/dev/chatbridge`.
  - Focused TDD handoff state is recorded in
    `.ai/state/tdd-handoff/CB-510/pipeline-status.json`.
  - Full repo validation passed with `pnpm test`, `pnpm check`, `pnpm lint`,
    `pnpm build`, and `git diff --check`.
  - No direct `src/renderer/packages/initial_data.ts` edit was required because
    preset seeded examples already derive from `getChatBridgeLiveSeedFixtures()`;
    the new Weather seed now flows into the preset corpus automatically.
