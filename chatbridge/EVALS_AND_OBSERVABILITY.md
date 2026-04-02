# ChatBridge Evals, Tracing, and Observability Foundation

This document is the Pack 0 observability and evaluation foundation for
ChatBridge. It complements the workflow route in
`.ai/workflows/trace-driven-development.md`
with concrete expectations for this repo.

## Foundation Principle

ChatBridge stories that change routing, tool execution, embedded app lifecycle,
completion, auth, or recovery should establish observable lifecycle seams and a
small eval set before broad implementation.

In practice, trace-driven development for ChatBridge means the important
behaviors and edge cases leave inspectable LangSmith evidence. A story is not
"trace-driven" merely because it emits a few spans; engineers should be able to
find named scenario or manual-smoke runs for the representative success,
failure, degraded, and continuity paths.

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

## CB-006 and CB-007 Supported Manual Smoke Path

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
5. Capture the returned run label and trace ID from the notice or active trace
   card. If the path is not traceable, the Seed Lab now returns an explicit
   non-traceable reason instead of silently failing.
6. Click `Mark Passed` or `Mark Failed`.
7. Inspect the run in project `chatbox-chatbridge` by trace ID.

Important constraints:

- The Seed Lab now classifies fixtures through the checked-in inspection seam:
  `active-flagship`, `platform-regression`, or `legacy-reference`.
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

For LangSmith thread views specifically, Chatbox now emits the supported
snake_case thread metadata on chat runs as well:

- `session_id`
- `thread_id`
- `conversation_id`
- `message_id`

These thread keys must exist on the parent chat turn and every child run inside
that turn, otherwise LangSmith thread filtering and per-thread cost/token
aggregation become incomplete.

## Eval Baseline

Every orchestration-heavy ChatBridge story should define at least:

1. happy path
2. malformed or invalid input path
3. timeout/crash/degraded path
4. one continuity/follow-up path when the story touches app state or memory

These scenarios should be wired so at least one supported environment can emit
named LangSmith proof runs for them. Checked-in tests may stay runnable with
tracing disabled by default, but the story is not trace-driven-complete until
the scenario harness can produce real traces when `LANGSMITH_TRACING=true`.

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

- live reviewed invoke selection and natural-Chess fallback:
  `src/renderer/packages/chatbridge/single-app-tools.ts`
- host bridge runtime:
  `src/renderer/packages/chatbridge/bridge/host-controller.ts`
- reviewed-app launch normalization:
  `src/renderer/packages/chatbridge/reviewed-app-launch.ts`
- reviewed-app bridge launch surface:
  `src/renderer/components/chatbridge/apps/ReviewedAppLaunchSurface.tsx`
- auth broker:
  `src/main/chatbridge/auth-broker/index.ts`
- resource proxy:
  `src/main/chatbridge/resource-proxy/index.ts`

### Model-level child traces

Every `getModel(...)` path now returns a LangSmith-wrapped model through
`src/shared/providers/index.ts`, so chat, stream, and paint calls emit child
LLM runs even when the caller only adds a parent chain trace.

`streamText(...)` now also propagates Chatbox conversation identifiers into the
LangSmith thread metadata contract for both the parent chain run and all child
LLM/planner runs:

- root conversations use `session.id` as the LangSmith `thread_id`
- branched thread conversations use the concrete `SessionThread.id`
- the active assistant message id is recorded as `message_id`

`CB-506` also adds a reviewed route-decision event from
`src/renderer/packages/model-calls/stream-text.ts`:

- event name:
  `chatbridge.routing.reviewed-app-decision`
- key outputs:
  `decisionKind`, `selectedAppId`, `selectionStatus`, `selectionSource`,
  `toolNames`

## Trace Naming Contract

- scenario evals:
  `chatbridge.eval.<slug>`
- desktop manual smoke:
  `chatbridge.manual_smoke.<slug>.<session-id>`

The shared naming and metadata builder lives in
`src/shared/models/tracing.ts`, and scenario wrappers live in
`test/integration/chatbridge/scenarios/scenario-tracing.ts`.

## Trace Metadata And Tags

Every ChatBridge parent trace should now expose these fields through metadata,
tags, or both:

- `primaryFamily` and `evidenceFamilies`
- `runtimeTarget`
- `smokeSupport`
- `surface`
- `storyId`

The current shared contract emits:

- metadata:
  `runtimeTarget: desktop-electron | integration-vitest`
- metadata:
  `smokeSupport: supported | scenario-only | legacy-reference`
- tags:
  `runtime-target:<value>`
- tags:
  `smoke-support:<value>`

This is what `CB-007` hardened so audit passes can separate supported desktop
smoke, scenario-only evidence, and legacy references without guessing from the
trace name alone.

## Scriptable Smoke Inspection

Use the checked-in pure helpers instead of renderer storage or ad hoc shell
probing when you need the current seed/preset corpus:

- live-seed fixture summary:
  `src/shared/chatbridge/live-seeds.ts` ->
  `getChatBridgeLiveSeedInspectionEntries()`
- combined live-seed plus preset-session snapshot:
  `src/renderer/packages/initial_data.ts` ->
  `getChatBridgeSmokeInspectionSnapshot()`

The combined snapshot is intentionally pure and does not initialize renderer
storage. A repeatable probe looks like this:

```bash
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && pnpm exec tsx <<'TS'
import { getChatBridgeSmokeInspectionSnapshot } from './src/renderer/packages/initial_data'
console.log(JSON.stringify(getChatBridgeSmokeInspectionSnapshot(), null, 2))
TS
```

The returned `liveSeeds` and `presetSessions` entries now include:

- `fixtureRole`
- `smokeSupport`

## CB-006 Trace Matrix

| Evidence family | Representative traces | Representative proof surfaces |
|---|---|---|
| catalog and baseline registry | `chatbridge.eval.chatbridge-reviewed-app-registry`, `chatbridge.eval.chatbridge-app-instance-domain-model` | `reviewed-app-registry.test.ts`, `app-instance-domain-model.test.ts` |
| routing | `chatbridge.eval.chatbridge-routing-artifacts` | `route-decision-artifacts.test.ts` |
| reviewed-app launch | `chatbridge.eval.chatbridge-single-app-discovery`, `chatbridge.eval.chatbridge-host-tool-contract`, `chatbridge.eval.chatbridge-reviewed-app-bridge-launch.cb-305-doc-proof-active`, `chatbridge.eval.chatbridge-reviewed-app-bridge-launch.cb-305-doc-proof-recovery`, `chatbridge.eval.chatbridge-mid-game-board-context`, `chatbridge.manual_smoke.chatbridge-chess-runtime.<session-id>` | `single-app-tool-discovery-and-invocation.test.ts`, `host-coordinated-tool-execution.test.ts`, `reviewed-app-bridge-launch.test.ts`, `ReviewedAppLaunchSurface.tsx`, `mid-game-board-context.test.ts`, `ChatBridgeSeedLab` |
| auth and resource access | `chatbridge.eval.chatbridge-story-builder-auth-resource` | `story-builder-lifecycle.test.ts` |
| recovery | `chatbridge.eval.chatbridge-bridge-handshake`, `chatbridge.manual_smoke.chatbridge-lifecycle-tour.<session-id>`, `chatbridge.manual_smoke.chatbridge-degraded-completion-recovery.<session-id>`, `chatbridge.manual_smoke.chatbridge-platform-recovery.<session-id>` | `bridge-session-security.test.ts`, `ChatBridgeSeedLab` |
| persistence | `chatbridge.eval.chatbridge-persistence-and-shell-artifacts`, `chatbridge.manual_smoke.chatbridge-chess-runtime.<session-id>` | `app-aware-persistence.test.ts`, `ChatBridgeSeedLab` |
| active catalog transition | `chatbridge.eval.chatbridge-active-reviewed-catalog-transition` | `active-reviewed-catalog-transition.test.ts` |

Notes:

- `CB-508` adds a traced active-catalog transition proof so the eval suite no
  longer presents the legacy flagship set as the only reviewed-app future.
- Story Builder auth/resource traces remain scenario-only legacy reference
  evidence until the active catalog and runtime queue reaches those later
  rebuild stories.
- `CB-007` hardened the same matrix with explicit runtime-target and
  smoke-support labels plus a scriptable seed/preset inspection seam.
- CB-305 now makes reviewed-app launch evidence explicit with one traced
  bridge-backed path for active runtime and one traced degraded recovery path;
  artifact preview stays on the separate `render-html-preview` seam.
- `CB-506` extends that reviewed-app launch evidence to the live invoke path:
  explicit Drawing Kit prompts now resolve through the reviewed route decision,
  natural Chess prompts stay on Chess through the narrow fallback seam, and
  representative proof traces live at
  `chatbridge.eval.chatbridge-live-reviewed-app-invocation-cb-506-doc-proof-active-drawing`,
  `chatbridge.eval.chatbridge-live-reviewed-app-invocation-cb-506-doc-proof-natural-chess`,
  and `chatbridge.eval.chatbridge-live-reviewed-app-invocation-cb-506-doc-proof-failure`.
- Chess is the only active flagship app with traced manual smoke today. Drawing
  Kit and Weather are now present in the active reviewed catalog, but their
  runtime/manual-smoke proof lands in later Pack 05 stories, not in CB-508.

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
