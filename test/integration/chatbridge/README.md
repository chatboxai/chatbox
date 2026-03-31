# ChatBridge Integration Harness

This folder is the Pack 0 starter home for ChatBridge integration tests.

It is intentionally lightweight at this stage. The goal is to give later packs
an agreed place for host/app/provider fixtures and lifecycle scenarios before
full ChatBridge runtime code lands.

Use this folder for:

- host lifecycle integration tests
- bridge payload fixtures
- reviewed app manifest fixtures
- completion and recovery scenarios
- mock registry, policy, auth-broker, and partner-runtime helpers

CB-104 establishes the first required regression slice in this folder:

- `scenarios/app-aware-persistence.test.ts`
  covers session reload, thread continuity, export formatting, and stale
  partial lifecycle behavior using deterministic host-owned fixtures

CB-201 adds the reviewed-manifest registry slice:

- `fixtures/reviewed-app-manifests.ts`
  provides deterministic reviewed app catalog entries for host-side tests
- `scenarios/reviewed-app-registry.test.ts`
  covers approved catalog ingestion plus malformed/unsupported rejection
  behavior

CB-204 adds the first host-coordinated tool execution contract slice:

- `scenarios/host-coordinated-tool-execution.test.ts`
  covers host-managed tool validation, idempotency enforcement, retry
  classification metadata, and normalized execution records using mock app
  tools wired through the current orchestration seam

CB-202 adds the first host-owned app instance and event record slice:

- `scenarios/app-instance-domain-model.test.ts`
  covers launch-scoped lifecycle recording, bridge/runtime event normalization,
  and durable hydration of `appInstance` plus `appEvent` records through the
  existing bridge controller seam

CB-303 adds the first live board-context reasoning slice:

- `scenarios/mid-game-board-context.test.ts`
  covers host-owned Chess board-summary normalization entering the
  `stream-text` model path for live and stale mid-game follow-up turns without
  exposing raw partner prose

That scenario set is the baseline gate for later ChatBridge packs that add real
app-aware schema, containers, and lifecycle events. New ChatBridge persistence,
manifest, or tool-execution changes should extend this suite instead of
creating isolated one-off tests elsewhere.

Reference:

- `chatbridge/INTEGRATION_HARNESS.md`
- `chatbridge/EVALS_AND_OBSERVABILITY.md`
