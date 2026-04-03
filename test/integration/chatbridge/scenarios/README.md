# ChatBridge Scenario Space

Use this folder for scenario-oriented integration coverage such as:

- happy-path lifecycle
- malformed payload rejection
- timeout or crash recovery
- completion and follow-up continuity
- auth request and denial

Each scenario should map back to a story packet or Pack roadmap item so the
coverage stays intentional.

For the post-Pack-4 single-agent rollout, scenario folders or files should be
named and organized so the owning story can link them directly from
`docs/specs/CHATBRIDGE-000-program-roadmap/**/status.md`.

## Trace Contract

When `LANGSMITH_TRACING=true`, representative scenario files should wrap their
cases with `runChatBridgeScenarioTrace(...)` from `scenario-tracing.ts`.

Naming prefixes:

- scenario evals: `chatbridge.eval.<slug>`
- desktop manual smoke: `chatbridge.manual_smoke.<slug>.<session-id>`

Metadata and tags should also identify:

- scenario family through `primaryFamily` and `evidenceFamilies`
- runtime target through `runtimeTarget` and `runtime-target:<value>`
- smoke support state through `smokeSupport` and `smoke-support:<value>`

Representative CB-006 traced scenario families now include:

- `active-reviewed-catalog-transition.test.ts`
- `reviewed-app-registry.test.ts`
- `app-instance-domain-model.test.ts`
- `host-coordinated-tool-execution.test.ts`
- `single-app-tool-discovery-and-invocation.test.ts`
- `mid-game-board-context.test.ts`
- `route-decision-artifacts.test.ts`
- `bridge-session-security.test.ts`
- `app-aware-persistence.test.ts`
- `story-builder-lifecycle.test.ts`

Legacy-reference scenario traces remain allowed when the scenario is explicitly
historical. Today that includes Story Builder auth/resource coverage while the
active Pack 05 queue targets Chess, Drawing Kit, and Weather.

Current Pack 07 recovery proof lives in:

- `bridge-session-security.test.ts`
  for malformed bridge traffic, replay rejection, launch timeout, and explicit
  runtime-crash recovery signals
- `drawing-kit-flagship.test.ts`
  for Drawing Kit checkpoint continuity, follow-up app-context injection, and
  runtime-crash fallback that preserves the last trusted doodle checkpoint
- `weather-dashboard-flagship.test.ts`
  for Weather Dashboard follow-up app-context injection, host-owned refresh,
  and degraded stale-snapshot fallback when upstream weather refresh fails
- `operator-controls-rollout.test.ts`
  for lifecycle observability records, version kill-switch launch blocking, and
  explicit active-session rollback posture

Current Pack 07 partner-DX proof lives in:

- `partner-sdk-harness.test.ts`
  for reviewed-partner manifest guidance, launch-scoped harness bootstrap,
  host-render delivery, replay rejection, and explicit recovery feedback for
  local partner debugging

Current Milestone 4 convergence proof lives in:

- `full-program-convergence.test.ts`
  for the cross-pack representative sweep across reviewed-app routing, Chess
  reasoning context, Debate Arena plus Story Builder continuity, Story Builder
  auth/resource access, policy denial, auth expiry, and partner harness replay
  rejection

For scriptable audit support outside the scenario runner, inspect the current
seed/preset corpus through
`src/renderer/packages/initial_data.ts` ->
`getChatBridgeSmokeInspectionSnapshot()` instead of booting renderer storage.
