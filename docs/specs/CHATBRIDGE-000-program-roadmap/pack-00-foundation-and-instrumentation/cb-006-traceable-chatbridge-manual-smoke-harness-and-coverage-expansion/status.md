# CB-006 Status

- status: validated
- pack: Pack 00 - Foundation and Instrumentation
- single-agent order: backfill 1 of 8
- blocked by: none
- unblocks: CB-305
- implementation surfaces:
  - `src/shared/models/tracing.ts`
  - `src/main/adapters/langsmith.ts`
  - `src/renderer/dev/chatbridgeManualSmoke.ts`
  - `src/renderer/dev/chatbridgeManualSmoke.test.ts`
  - `test/integration/chatbridge/scenarios/`
  - `src/renderer/components/dev/ChatBridgeSeedLab.tsx`
  - `src/renderer/components/dev/ChatBridgeSeedLab.test.tsx`
  - `test/integration/chatbridge/scenarios/scenario-tracing.ts`
  - `chatbridge/EVALS_AND_OBSERVABILITY.md`
- validation surfaces:
  - `src/main/adapters/langsmith.test.ts`
  - `src/renderer/dev/chatbridgeManualSmoke.test.ts`
  - `src/renderer/components/dev/ChatBridgeSeedLab.test.tsx`
  - `test/integration/chatbridge/scenarios/scenario-tracing.test.ts`
  - `test/integration/chatbridge/scenarios/reviewed-app-registry.test.ts`
  - `test/integration/chatbridge/scenarios/host-coordinated-tool-execution.test.ts`
  - `test/integration/chatbridge/scenarios/app-instance-domain-model.test.ts`
  - `test/integration/chatbridge/scenarios/single-app-tool-discovery-and-invocation.test.ts`
  - `test/integration/chatbridge/scenarios/mid-game-board-context.test.ts`
  - `test/integration/chatbridge/scenarios/app-aware-persistence.test.ts`
  - `test/integration/chatbridge/scenarios/route-decision-artifacts.test.ts`
  - `test/integration/chatbridge/scenarios/bridge-session-security.test.ts`
  - `test/integration/chatbridge/scenarios/story-builder-lifecycle.test.ts`
  - `chatbridge/EVALS_AND_OBSERVABILITY.md`
  - LangSmith project `chatbox-chatbridge`
- happy-path scenario proof:
  - supported desktop Seed Lab smoke now emits `chatbridge.manual_smoke.*`
    parent traces; representative proof:
    `chatbridge.manual_smoke.chatbridge-chess-runtime.cb-006-doc-proof`
    -> `bdb26275-763b-4d6f-a1e7-ffc952502e79`
  - representative eval traces now cover catalog, reviewed-app launch,
    persistence, and board-context families:
    - `chatbridge.eval.chatbridge-reviewed-app-registry`
      -> `019d465f-b37c-7000-8000-03766cea7e83`
    - `chatbridge.eval.chatbridge-single-app-discovery`
      -> `019d4660-5956-7000-8000-006a6c7e96db`
    - `chatbridge.eval.chatbridge-mid-game-board-context`
      -> `019d4660-723a-7000-8000-020a63a07686`
    - `chatbridge.eval.chatbridge-persistence-and-shell-artifacts`
      -> `019d465f-8f90-7000-8000-0670371055f9`
- failure or degraded proof:
  - unsupported runtimes now fail explicitly through
    `src/renderer/dev/chatbridgeManualSmoke.test.ts`; web-only smoke remains
    documented as unsupported rather than silently non-traced
  - representative eval traces now cover routing, recovery, and legacy
    auth/resource references:
    - `chatbridge.eval.chatbridge-routing-artifacts`
      -> `c08c1858-9964-4b66-9af3-58f79c739ef2`
    - `chatbridge.eval.chatbridge-bridge-handshake`
      -> `019d4660-05b0-7000-8000-047ebfe7755a`
    - `chatbridge.eval.chatbridge-story-builder-auth-resource`
      -> `10ffa943-3bc4-43eb-88ec-7d0996d3dcff`
- acceptance-criteria status:
  - AC-1 met: the supported desktop `/dev/chatbridge` Seed Lab path now starts,
    surfaces, and finishes named LangSmith manual-smoke runs for active Chess
    fixtures.
  - AC-2 met: the trace matrix now has explicit named evidence for routing,
    reviewed-app launch, recovery, persistence, and legacy Story Builder
    auth/resource seams under one shared project.
  - AC-3 met: checked-in observability docs and the smoke ledger now explain
    how to run the supported smoke flow, collect trace ids, and map them back
    to specific scenario families.
- notes:
  - Opened from `smoke-audit-master.md` finding SA-006.
  - CB-006 intentionally does not add Drawing Kit or Weather runtime coverage;
    those remain later queue items and are called out as known gaps rather than
    pretending they are already observable.
  - No `src/renderer/packages/initial_data.ts` refresh was required because
    CB-006 only changes tracing, dev tooling, and documentation around existing
    ChatBridge seeded fixtures.
