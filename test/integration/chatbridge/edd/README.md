# ChatBridge EDD Harness

This folder holds the local-first eval-driven development layer for
orchestration-heavy ChatBridge behavior.

## Commands

- Local proof only:
  - `pnpm run test:chatbridge:edd`
- Live LangSmith upload plus local proof:
  - `pnpm run test:chatbridge:edd:live`

Local runs are the default. Live LangSmith uploads are opt-in through
`LANGSMITH_TEST_TRACKING=true`.

## Files

- `recompleted-stories.eval.ts`: backfilled regression coverage over the
  already-merged ChatBridge runtime stories that should have had EDD from the
  start
- `scenario-runner.ts`: shared wrapper for scenario execution, event recording,
  and proof emission
- `local-log.ts`: JSON proof writer under `test/output/chatbridge-edd/`
- `langsmith.ts`: env normalization and optional trace-step helper
- `test-utils.ts`: deterministic mock message-port helpers

## Story Coverage

- `CB-102`, `CB-103`, `CB-104`
  - scenario: `chatbridge-persistence-and-shell-artifacts`
- `CB-201`
  - scenario: `chatbridge-reviewed-app-registry`
- `CB-202`
  - scenario: `chatbridge-app-instance-domain-model`
- `CB-203`
  - scenario: `chatbridge-bridge-handshake`
- `CB-204`
  - scenario: `chatbridge-host-tool-contract`
- `CB-300`
  - scenario: `chatbridge-single-app-discovery`
- `CB-303`
  - scenario: `chatbridge-mid-game-board-context`

## Operating Model

- Local JSON proof is the required baseline.
- Live LangSmith uploads are a finish-check layer, not the only evidence.
- Quota or credential failures should block only the live verification step and
  must be recorded explicitly instead of being mistaken for product failures.
