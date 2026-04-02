# CB-305 Agent 1 Test Notes

- Authored or expanded focused coverage in:
  - `src/renderer/packages/chatbridge/reviewed-app-launch.test.ts`
  - `src/renderer/packages/chatbridge/bridge/reviewed-app-runtime.test.ts`
  - `src/renderer/components/chatbridge/apps/ReviewedAppLaunchSurface.test.tsx`
  - `src/renderer/components/Artifact.test.tsx`
  - `test/integration/chatbridge/scenarios/reviewed-app-bridge-launch.test.ts`
- Contract emphasis:
  - reviewed host-tool results must become real ChatBridge `app` parts
  - reviewed launches must boot through the bridge host controller
  - active and degraded lifecycle state must remain host-owned and persisted
  - artifact preview must stay on the separate HTML-preview seam
