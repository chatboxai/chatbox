# ChatBridge Evals, Tracing, and Observability Foundation

This document is the Pack 0 observability and evaluation foundation for
ChatBridge. It complements the workflow route in
`.ai/workflows/trace-driven-development.md`
with concrete expectations for this repo.

## Foundation Principle

ChatBridge stories that change routing, tool execution, embedded app lifecycle,
completion, auth, or recovery should establish observable lifecycle seams and a
small eval set before broad implementation.

That foundation is now local-first:

- reusable ChatBridge EDD scenarios live in `test/integration/chatbridge/edd/`
- vendor-neutral proof logs are written to `test/output/chatbridge-edd/`
- live LangSmith uploads are opt-in through
  `.ai/workflows/langsmith-finish-check.md` when fresh remote proof matters

## Current Repo Observability Seams

### Runtime error and telemetry hooks

- main-process Sentry:
  `src/main/adapters/sentry.ts`
- renderer Sentry init:
  `src/renderer/setup/sentry_init.ts`
- shared adapter interface:
  `src/shared/utils/sentry_adapter.ts`
- existing error-handling foundation:
  `ERROR_HANDLING.md`

### Test-side observability seam

- mock sentry adapter:
  `test/integration/mocks/sentry.ts`

### ChatBridge EDD seam

- Vitest config:
  `ls.vitest.config.ts`
- local EDD suite:
  `test/integration/chatbridge/edd/recompleted-stories.eval.ts`
- local proof logger:
  `test/integration/chatbridge/edd/local-log.ts`
- LangSmith env normalization and trace-step helper:
  `test/integration/chatbridge/edd/langsmith.ts`
- reusable scenario wrapper:
  `test/integration/chatbridge/edd/scenario-runner.ts`
- suite commands:
  - `pnpm run test:chatbridge:edd`
  - `pnpm run test:chatbridge:edd:live`

## What Later ChatBridge Stories Must Make Observable

### Required lifecycle checkpoints

- route decision
- app eligibility result
- app instance creation
- bridge session started
- app ready
- tool invocation attempt
- tool invocation result
- app state update accepted or rejected
- completion accepted or degraded
- auth requested / granted / denied
- recovery path entered

### Minimum correlation fields

- `sessionId`
- `messageId`
- `appId`
- `appInstanceId`
- `bridgeSessionId`
- `toolCallId` when applicable
- `completionId` or idempotency key for state-changing events

## Eval Baseline

Every orchestration-heavy ChatBridge story should define at least:

1. happy path
2. malformed or invalid input path
3. timeout/crash/degraded path
4. one continuity/follow-up path when the story touches app state or memory

## Starter Scenario Matrix

### Pack 01

- app-aware message artifacts remain serializable
- host container states survive reload

### Pack 02

- manifest rejected
- stale or replayed bridge event rejected
- tool invocation schema mismatch rejected

### Pack 03

- single app invoked correctly
- app renders and sends ready/state/complete
- follow-up question can use current app state

### Pack 04

- completion payload normalized
- degraded completion still produces recoverable host behavior
- later turn can use stored summary

### Pack 05-07

- ambiguity clarified or refused correctly
- multi-app switch preserves correct context boundaries
- auth denied or expired path is explainable
- platform-wide failure has a host-owned recovery state

## Privacy and Security Guardrails

- do not log raw secrets
- avoid storing raw sensitive student content in reusable traces or fixtures
- prefer normalized summaries over arbitrary partner payload dumps
- record enough metadata to explain behavior without turning observability into
  surveillance

## Vendor-Neutral Foundation Rule

Sentry is the current repo telemetry seam, but Pack 0 should stay vendor-neutral
at the contract level.

That means:

- stories may use Sentry-adapter-backed events now
- story packets should describe required lifecycle signals, not just a specific
  vendor feature
- future backend sinks, health dashboards, or eval runners can plug into the
  same event model later

## How This Connects To The Workflow

Use
`.ai/workflows/trace-driven-development.md`
when a story changes:

- routing or app selection
- tool discovery or execution
- embedded app lifecycle
- completion and app-aware memory
- auth brokerage or resource access
- failure recovery semantics

## Recommended Starter Assets

- `test/integration/chatbridge/scenarios/` for representative lifecycle cases
- `test/integration/chatbridge/edd/` for durable local-first EDD coverage
- story-level trace/eval sections in later technical plans
- reusable mock observability sink for integration tests when later stories need
  assertion on emitted lifecycle events

## Recompleted Story Baseline

The EDD retrofit now backfills the completed orchestration-heavy ChatBridge
stories that were previously merged without a dedicated EDD layer:

- `CB-102`, `CB-103`, `CB-104`: persistence, shell artifacts, exportability,
  and stale partial lifecycle continuity
- `CB-201`: reviewed app registry acceptance and rejection
- `CB-202`: host-owned lifecycle record stream and hydration
- `CB-203`: launch-scoped bridge handshake and replay rejection
- `CB-204`: host-coordinated tool execution contract
- `CB-300`: reviewed single-app discovery, match, and ambiguity refusal
- `CB-303`: live and stale Chess board-context injection before model calls

The inventory and proof mapping live in:

- `docs/specs/CHATBRIDGE-000-program-roadmap/pack-00-foundation-and-instrumentation/cb-003-evals-tracing-and-observability-foundation/edd-recompletion-inventory.md`
- `test/integration/chatbridge/edd/recompleted-stories.eval.ts`

## Known Gaps

- there is still no production-grade ChatBridge trace sink beyond the current
  app telemetry seams and the local EDD proof layer
- live LangSmith verification depends on valid credentials and account quota;
  quota exhaustion should block only the remote finish check, not local EDD
- later implementation stories still need to deepen event payloads and
  scenario coverage on top of this baseline rather than starting over
