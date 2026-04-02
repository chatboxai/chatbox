# CB-007 Status

- status: validated
- pack: Pack 00 - Foundation and Instrumentation
- single-agent order: backfill 2 of 9
- blocked by: CB-006
- unblocks: CB-305
- implementation surfaces:
  - `src/shared/models/tracing.ts`
  - `src/renderer/dev/chatbridgeManualSmoke.ts`
  - `src/renderer/components/dev/ChatBridgeSeedLab.tsx`
  - `test/integration/chatbridge/scenarios/scenario-tracing.ts`
  - `src/shared/chatbridge/live-seeds.ts`
  - `src/renderer/packages/initial_data.ts`
  - `chatbridge/EVALS_AND_OBSERVABILITY.md`
- validation surfaces:
  - `src/shared/chatbridge/live-seeds.test.ts`
  - `src/renderer/packages/initial_data.test.ts`
  - `src/renderer/dev/chatbridgeManualSmoke.test.ts`
  - `test/integration/chatbridge/scenarios/scenario-tracing.test.ts`
  - `src/renderer/components/dev/ChatBridgeSeedLab.test.tsx`
  - LangSmith project `chatbox-chatbridge`
  - scriptable seed/preset inventory probe
- happy-path scenario proof:
  - supported manual smoke now returns a normalized trace handoff with explicit
    `traceId`, `traceLabel`, `runtimeTarget`, and `supportState` values for
    supported active fixtures
  - representative trace proof:
    - `chatbridge.manual_smoke.chatbridge-chess-runtime.cb-007-doc-proof`
      -> `55c99c6f-9854-4a11-babd-5ef0f2cb3b18`
    - `chatbridge.eval.chatbridge-routing-artifacts.cb-007-doc-proof`
      -> `92297c7b-8721-4927-a0b6-956d4ef835a7`
- failure or degraded proof:
  - unsupported smoke targets and missing desktop trace support now return
    explicit non-traceable outcomes with reason-coded support state instead of
    collapsing into `langsmith-disabled`
  - scriptable corpus probe:
    - `getChatBridgeSmokeInspectionSnapshot()` now returns schema version `1`
      plus the current live-seed fixture ids and preset session ids without
      touching renderer storage
- acceptance-criteria status:
  - AC-1 met: supported manual-smoke and scenario traces now carry explicit
    runtime-target and smoke-support metadata/tags alongside the scenario
    family contract.
  - AC-2 met: the manual smoke helper and Seed Lab now work from a normalized
    handoff that returns either `traceId` plus `traceLabel` or an explicit
    non-traceable reason.
  - AC-3 met: the checked-in smoke inspection seam now exposes the live-seed
    and preset-session corpus through pure helpers in `live-seeds.ts` and
    `initial_data.ts`.
- notes:
  - Opened from the post-audit delta pass after `CB-006` began implementation.
  - This story hardens trace evidence quality and scriptable smoke inspection
    without reopening the initial supported-smoke-path scope of `CB-006`.
  - No seeded example refresh was required beyond the new pure inspection
    snapshot because the underlying fixture corpus itself did not change.
