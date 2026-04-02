# CB-007 Agent 1 Test Notes

- Authored or expanded focused coverage in:
  - `test/integration/chatbridge/scenarios/scenario-tracing.test.ts`
  - `src/renderer/dev/chatbridgeManualSmoke.test.ts`
  - `src/renderer/components/dev/ChatBridgeSeedLab.test.tsx`
  - `src/shared/chatbridge/live-seeds.test.ts`
  - `src/renderer/packages/initial_data.test.ts`
- Contract emphasis:
  - scenario and manual-smoke traces must identify runtime target and smoke support
  - supported manual smoke must hand back trace ids and run labels explicitly
  - unsupported fixtures and unavailable desktop tracing must return reason-coded outcomes
  - the live-seed and preset-session corpus must be inspectable without renderer-storage side effects
