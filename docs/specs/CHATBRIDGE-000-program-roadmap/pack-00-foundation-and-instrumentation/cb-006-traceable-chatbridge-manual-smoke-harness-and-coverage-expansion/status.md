# CB-006 Status

- status: planned
- pack: Pack 00 - Foundation and Instrumentation
- single-agent order: backfill 1 of 8
- blocked by: none
- unblocks: CB-305, CB-506, CB-605
- implementation surfaces:
  - `src/main/adapters/langsmith.ts`
  - `src/renderer/adapters/langsmith.ts`
  - `src/shared/models/tracing.ts`
  - `test/integration/chatbridge/scenarios/`
  - `src/renderer/components/dev/ChatBridgeSeedLab.tsx`
- validation surfaces:
  - `test/integration/chatbridge/scenarios/`
  - `chatbridge/EVALS_AND_OBSERVABILITY.md`
  - manual smoke traces in LangSmith
- happy-path scenario proof:
  - planned: supported smoke runs emit trace ids for rebuilt flagship flows
- failure or degraded proof:
  - planned: unsupported runtime targets fail explicitly and remain documented
- acceptance-criteria status:
  - AC-1 planned
  - AC-2 planned
  - AC-3 planned
- notes:
  - Opened from `smoke-audit-master.md` finding SA-006.
  - This story should establish the observability spine before deeper runtime
    rebuild work starts.
