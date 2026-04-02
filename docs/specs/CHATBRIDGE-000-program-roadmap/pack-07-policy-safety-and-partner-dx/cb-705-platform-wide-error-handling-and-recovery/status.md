# CB-705 Status

- status: validated
- pack: Pack 07 - Error Handling, Safety, and Partner DX
- single-agent order: 3 of 5
- blocked by: none
- unblocks: CB-702
- implementation surfaces:
  - `src/shared/chatbridge/recovery-contract.ts`
  - `src/shared/chatbridge/recovery.ts`
  - `src/shared/chatbridge/degraded-completion.ts`
  - `src/renderer/packages/chatbridge/bridge/host-controller.ts`
  - `src/shared/chatbridge/live-seeds.ts`
  - `src/renderer/setup/preset_sessions.test.ts`
- validation surfaces:
  - `src/shared/chatbridge/recovery-contract.test.ts`
  - `src/shared/chatbridge/recovery.test.ts`
  - `src/shared/chatbridge/degraded-completion.test.ts`
  - `src/shared/chatbridge/live-seeds.test.ts`
  - `test/integration/chatbridge/scenarios/bridge-session-security.test.ts`
  - `src/renderer/setup/preset_sessions.test.ts`
- happy-path scenario proof:
  - `src/shared/chatbridge/live-seeds.test.ts` proves the new `Platform recovery`
    seeded session is published through the preset catalog for local and
    production inspection.
- failure or degraded proof:
  - `test/integration/chatbridge/scenarios/bridge-session-security.test.ts`
    proves malformed bridge traffic, launch timeout, and explicit runtime crash
    recovery signals at the host boundary.
- acceptance-criteria status:
  - AC-1 met: explicit host-owned recovery contracts now classify timeout,
    crash, invalid tool call, malformed bridge event, and bridge rejection
    paths.
  - AC-2 met: recovery contracts feed the existing degraded shell and recovery
    prompt path with bounded next actions.
  - AC-3 met: recovery decisions now emit structured trace and audit metadata
    through the bridge host controller instead of staying local-only UI logic.
- notes:
  - No direct `src/renderer/packages/initial_data.ts` edit was required because
    ChatBridge seeded examples already flow from `src/shared/chatbridge/live-seeds.ts`,
    and CB-705 refreshed that canonical seed catalog by adding the new
    `Platform recovery` fixture.
