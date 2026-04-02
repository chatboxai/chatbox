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

## CB-006 Supported Manual Smoke Path

The supported traced manual smoke path for the rebuild queue is now the desktop
ChatBridge Seed Lab, not the web-only smoke surface.

Use this path:

1. Start the desktop app with `LANGSMITH_API_KEY` present and
   `LANGSMITH_TRACING=true`.
2. Open `ChatBridge Seed Lab`.
3. Use `Reseed & Open` on one of the supported fixture cards:
   - `lifecycle-tour`
   - `degraded-completion-recovery`
   - `platform-recovery`
   - `chess-mid-game-board-context`
   - `chess-runtime`
4. Perform the listed audit steps in the seeded thread.
5. Click `Mark Passed` or `Mark Failed`, then copy the trace ID from the card or
   success banner.
6. Inspect the run in project `chatbox-chatbridge` by trace ID.

Important constraints:

- Web-only smoke remains unsupported for traced manual smoke because
  `window.electronAPI` is unavailable there and LangSmith access stays
  main-process-owned.
- `history-and-preview` remains a legacy Story Builder reference fixture. It is
  available for historical inspection, but it is not active flagship smoke
  evidence.

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

## Trace Naming Contract

- scenario evals:
  `chatbridge.eval.<slug>`
- desktop manual smoke:
  `chatbridge.manual_smoke.<slug>.<session-id>`

The shared naming and metadata builder lives in
`src/shared/models/tracing.ts`, and scenario wrappers live in
`test/integration/chatbridge/scenarios/scenario-tracing.ts`.

## CB-006 Trace Matrix

| Evidence family | Representative traces | Representative proof surfaces |
|---|---|---|
| catalog and baseline registry | `chatbridge.eval.chatbridge-reviewed-app-registry`, `chatbridge.eval.chatbridge-app-instance-domain-model` | `reviewed-app-registry.test.ts`, `app-instance-domain-model.test.ts` |
| routing | `chatbridge.eval.chatbridge-routing-artifacts` | `route-decision-artifacts.test.ts` |
| reviewed-app launch | `chatbridge.eval.chatbridge-single-app-discovery`, `chatbridge.eval.chatbridge-host-tool-contract`, `chatbridge.eval.chatbridge-mid-game-board-context`, `chatbridge.manual_smoke.chatbridge-chess-runtime.<session-id>` | `single-app-tool-discovery-and-invocation.test.ts`, `host-coordinated-tool-execution.test.ts`, `mid-game-board-context.test.ts`, `ChatBridgeSeedLab` |
| auth and resource access | `chatbridge.eval.chatbridge-story-builder-auth-resource` | `story-builder-lifecycle.test.ts` |
| recovery | `chatbridge.eval.chatbridge-bridge-handshake`, `chatbridge.manual_smoke.chatbridge-lifecycle-tour.<session-id>`, `chatbridge.manual_smoke.chatbridge-degraded-completion-recovery.<session-id>`, `chatbridge.manual_smoke.chatbridge-platform-recovery.<session-id>` | `bridge-session-security.test.ts`, `ChatBridgeSeedLab` |
| persistence | `chatbridge.eval.chatbridge-persistence-and-shell-artifacts`, `chatbridge.manual_smoke.chatbridge-chess-runtime.<session-id>` | `app-aware-persistence.test.ts`, `ChatBridgeSeedLab` |

Notes:

- Story Builder auth/resource traces remain scenario-only legacy reference
  evidence until the active catalog and runtime queue reaches those later
  rebuild stories.
- Chess is the only active flagship app with traced manual smoke today. Drawing
  Kit and Weather join this matrix in later Pack 05 stories, not in CB-006.

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
- Web-only manual smoke remains intentionally non-traced until a host-owned
  traced bridge exists for that runtime surface.
- Trace coverage is now explicit for the representative rebuild families above,
  but future work should keep extending the matrix when new flagship apps or
  recovery seams land.
- Privacy rules still apply: traces should continue using the existing
  sanitization and redaction helpers rather than logging arbitrary raw payloads.
