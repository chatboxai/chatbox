# CB-007 Status

- status: planned
- pack: Pack 00 - Foundation and Instrumentation
- single-agent order: backfill 2 of 9
- blocked by: CB-006
- unblocks: CB-305
- implementation surfaces:
  - `src/shared/models/tracing.ts`
  - `src/main/adapters/langsmith.ts`
  - `src/renderer/dev/chatbridgeManualSmoke.ts`
  - `src/renderer/components/dev/ChatBridgeSeedLab.tsx`
  - `test/integration/chatbridge/scenarios/scenario-tracing.ts`
  - `src/shared/chatbridge/live-seeds.ts`
  - `src/renderer/packages/initial_data.ts`
- validation surfaces:
  - `test/integration/chatbridge/scenarios/scenario-tracing.test.ts`
  - LangSmith smoke traces with metadata/tags
  - scriptable seed/preset inventory probe
  - seed-lab or helper trace-id handoff
- happy-path scenario proof:
  - planned: supported smoke runs emit distinct trace families with metadata
    and return a usable trace id/run label to the tester
- failure or degraded proof:
  - planned: unsupported smoke targets or missing LangSmith config return
    explicit non-traceable outcomes while scriptable corpus inspection still
    works
- acceptance-criteria status:
  - AC-1 planned
  - AC-2 planned
  - AC-3 planned
- notes:
  - Opened from the post-audit delta pass after `CB-006` began implementation.
  - This story hardens trace evidence quality and scriptable smoke inspection
    without reopening the initial supported-smoke-path scope of `CB-006`.
