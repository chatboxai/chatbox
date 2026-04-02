# ChatBridge Evals, Tracing, and Observability Foundation

This document is the Pack 0 observability and evaluation foundation for
ChatBridge. It complements the workflow route in
`.ai/workflows/trace-driven-development.md`
with concrete expectations for this repo.

## Foundation Principle

ChatBridge stories that change routing, tool execution, embedded app lifecycle,
completion, auth, or recovery should establish observable lifecycle seams and a
small eval set before broad implementation.

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

### LangSmith tracing seam

- shared LangSmith contract and sanitization:
  `src/shared/utils/langsmith_adapter.ts`
- shared model wrapper for `chat`, `chatStream`, and `paint`:
  `src/shared/models/tracing.ts`
- main-process LangSmith sink and IPC bridge:
  `src/main/adapters/langsmith.ts`
- renderer IPC-backed adapter:
  `src/renderer/adapters/langsmith.ts`

LangSmith API access remains main-process-owned. Renderer code talks to the
main sink through IPC-backed adapters, and tests default to a noop sink unless
`LANGSMITH_TRACING=true` is set explicitly.

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

## Current Trace Coverage

### Top-level app flows

- session text generation:
  `src/renderer/packages/model-calls/stream-text.ts`
- non-streaming text generation helper:
  `src/renderer/packages/model-calls/index.ts`
- OCR preprocessing:
  `src/renderer/packages/model-calls/preprocess.ts`
- summary generation:
  `src/renderer/packages/context-management/summary-generator.ts`
- session naming:
  `src/renderer/stores/session/naming.ts`
- model capability tests from settings:
  `src/renderer/utils/model-tester.ts`
- image generation:
  `src/renderer/packages/model-calls/generate-image.ts`
  and
  `src/renderer/stores/imageGenerationActions.ts`
- provider model discovery in settings:
  `src/renderer/packages/model-setting-utils/registry-setting-util.ts`
  and
  `src/renderer/packages/model-setting-utils/custom-provider-setting-util.ts`
- local knowledge-base OCR parsing:
  `src/main/knowledge-base/parsers/local-parser.ts`

### ChatBridge lifecycle seams

- host bridge runtime:
  `src/renderer/packages/chatbridge/bridge/host-controller.ts`
- auth broker:
  `src/main/chatbridge/auth-broker/index.ts`
- resource proxy:
  `src/main/chatbridge/resource-proxy/index.ts`

### Model-level child traces

Every `getModel(...)` path now returns a LangSmith-wrapped model through
`src/shared/providers/index.ts`, so chat, stream, and paint calls emit child
LLM runs even when the caller only adds a parent chain trace.

## Live Smoke Proof

As of the current implementation, LangSmith live traces are landing in project
`chatbox-chatbridge`. A manual smoke trace emitted from this repo landed as:

- trace name: `chatbox.trace.smoke`
- trace id: `7020574d-8d43-46d6-8c41-b89522667be7`

That smoke trace used the same main-process sink and shared model wrapper that
the application now uses for runtime traces.

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
- story-level trace/eval sections in later technical plans
- reusable mock observability sink for integration tests when later stories need
  assertion on emitted lifecycle events

## Remaining Gaps

- LangSmith is now wired across the main user-facing app flows, but there is
  still no checked-in dashboard or alerting layer built on top of those traces.
- Trace coverage is strongest for model/runtime seams and major lifecycle
  transitions. If future work adds new network-heavy settings flows, background
  jobs, or partner onboarding commands, those should explicitly add parent
  chain traces instead of relying only on wrapped model child runs.
- Privacy rules still apply: traces should continue using the existing
  sanitization and redaction helpers rather than logging arbitrary raw payloads.
