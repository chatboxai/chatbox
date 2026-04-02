# CB-305 Status

- status: validated
- pack: Pack 03 - Chess Vertical Slice
- single-agent order: backfill 2 of 8
- blocked by: CB-006
- unblocks: CB-508
- implementation surfaces:
  - `src/renderer/packages/chatbridge/reviewed-app-launch.ts`
  - `src/renderer/packages/chatbridge/bridge/reviewed-app-runtime.ts`
  - `src/renderer/components/chatbridge/apps/ReviewedAppLaunchSurface.tsx`
  - `src/renderer/packages/chatbridge/bridge/host-controller.ts`
  - `src/renderer/packages/model-calls/stream-text.ts`
  - `src/renderer/components/chatbridge/apps/surface.tsx`
  - `src/renderer/components/chatbridge/chatbridge.ts`
  - `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
  - `src/shared/chatbridge/bridge-session.ts`
  - `src/renderer/components/Artifact.tsx`
- validation surfaces:
  - `src/renderer/packages/chatbridge/reviewed-app-launch.test.ts`
  - `src/renderer/packages/chatbridge/bridge/reviewed-app-runtime.test.ts`
  - `src/renderer/components/chatbridge/apps/ReviewedAppLaunchSurface.test.tsx`
  - `src/renderer/components/Artifact.test.tsx`
  - `test/integration/chatbridge/scenarios/reviewed-app-bridge-launch.test.ts`
  - LangSmith project `chatbox-chatbridge`
- happy-path scenario proof:
  - a reviewed Chess launch now becomes a live `app` part, boots through
    `ReviewedAppLaunchSurface`, and persists host-owned lifecycle state through
    the bridge host controller rather than stopping at a tool-call result
  - representative trace proof:
    - `chatbridge.eval.chatbridge-reviewed-app-bridge-launch.cb-305-doc-proof-active`
      -> `deef96de-e657-465f-b7f8-8aef3914cd9a`
- failure or degraded proof:
  - bridge startup failure now degrades through the normalized host recovery
    contract without falling back to artifact preview or a synthetic seeded
    shell
  - representative trace proof:
    - `chatbridge.eval.chatbridge-reviewed-app-bridge-launch.cb-305-doc-proof-recovery`
      -> `bf430aef-39d3-4199-8526-9b456090778b`
- acceptance-criteria status:
  - AC-1 met: reviewed host-tool results are normalized into real ChatBridge
    `app` parts and rendered through `ReviewedAppLaunchSurface`, which uses the
    bridge host controller as the launch seam.
  - AC-2 met: bridge bootstrap, ready, state, and recovery events now persist
    host-owned lifecycle state through `reviewed-app-launch.ts`, while
    artifact-preview behavior stays on the explicit `render-html-preview` path.
  - AC-3 met: focused unit/integration coverage plus named LangSmith proof runs
    now show the bridge controller is the live reviewed-app launch seam.
- notes:
  - Opened from `smoke-audit-master.md` finding SA-005.
  - This story restores the real reviewed-app launch seam before broader
    multi-app rebuild work continues, while keeping artifact preview explicitly
    separate.
  - No `src/renderer/packages/initial_data.ts` refresh was required because
    CB-305 changes runtime wiring and traced proof, not the seeded example data
    set.
