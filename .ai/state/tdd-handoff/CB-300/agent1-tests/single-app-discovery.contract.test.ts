// Agent 1 contract for CB-300.
// The executable repo tests live in:
// - src/shared/chatbridge/single-app-discovery.test.ts
// - src/renderer/packages/chatbridge/single-app-tools.test.ts
// - test/integration/chatbridge/scenarios/single-app-tool-discovery-and-invocation.test.ts

export const cb300Agent1Contract = [
  'explicit Chess requests resolve to the approved chess_prepare_session tool',
  'unrelated prompts remain chat-only',
  'generic board-game prompts are treated as ambiguous, not auto-routed to Chess',
  'the approved Chess tool executes through the host-managed ChatBridge wrapper',
  'malformed Chess tool args fail closed with invalid_input',
  'Chess invocation failures normalize into host-visible tool_execution_failed records',
]
