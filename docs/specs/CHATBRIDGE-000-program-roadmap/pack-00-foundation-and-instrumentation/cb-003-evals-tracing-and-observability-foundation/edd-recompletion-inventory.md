# CB-003 EDD Recompletion Inventory

## Purpose

Pack 0 originally established trace/eval intent, but it did not land a durable
ChatBridge EDD layer over the merged runtime stories. This inventory records
the retrofit that recompeted those stories with local-first EDD coverage.

## Recompleted Story Set

| Story ID | Runtime Surface | EDD Scenario ID | Primary Proof |
|---|---|---|---|
| `CB-102` | app-aware session persistence | `chatbridge-persistence-and-shell-artifacts` | `test/integration/chatbridge/edd/recompleted-stories.eval.ts` |
| `CB-103` | shell artifacts and export continuity | `chatbridge-persistence-and-shell-artifacts` | `test/integration/chatbridge/edd/recompleted-stories.eval.ts` |
| `CB-104` | stale partial lifecycle recovery | `chatbridge-persistence-and-shell-artifacts` | `test/integration/chatbridge/edd/recompleted-stories.eval.ts` |
| `CB-201` | reviewed app registry ingestion/rejection | `chatbridge-reviewed-app-registry` | `test/integration/chatbridge/edd/recompleted-stories.eval.ts` |
| `CB-202` | app instance lifecycle records and hydration | `chatbridge-app-instance-domain-model` | `test/integration/chatbridge/edd/recompleted-stories.eval.ts` |
| `CB-203` | bridge handshake and replay rejection | `chatbridge-bridge-handshake` | `test/integration/chatbridge/edd/recompleted-stories.eval.ts` |
| `CB-204` | host-coordinated tool execution | `chatbridge-host-tool-contract` | `test/integration/chatbridge/edd/recompleted-stories.eval.ts` |
| `CB-300` | reviewed single-app routing and ambiguity refusal | `chatbridge-single-app-discovery` | `test/integration/chatbridge/edd/recompleted-stories.eval.ts` |
| `CB-303` | live and stale Chess board-context reasoning | `chatbridge-mid-game-board-context` | `test/integration/chatbridge/edd/recompleted-stories.eval.ts` |

## Local Proof Model

- Each scenario writes a vendor-neutral JSON artifact under
  `test/output/chatbridge-edd/`.
- The shared scenario runner records step boundaries and outputs so the proof is
  inspectable even when remote LangSmith uploads are unavailable.
- Live LangSmith uploads are optional and should be treated as a finish-check
  layer rather than the only source of truth.

## Commands

```bash
pnpm run test:chatbridge:edd
pnpm run test:chatbridge:edd:live
```

## Current Live-Verification Note

The initial retrofit used a borrowed local LangSmith token to validate the
integration path. The suite proved the code path, but live uploads hit a
LangSmith account usage limit (`monthly_traces` quota exceeded). That is an
environment blocker, not a product regression, so local EDD remains the
required baseline until a healthy LangSmith project is available.
