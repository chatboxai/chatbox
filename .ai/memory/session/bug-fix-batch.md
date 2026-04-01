# Bug Fix Batch

Use this ledger only when a task is intentionally being handled as a bounded bug
batch.

| Bug ID | Symptom | Expected Behavior | Evidence Source | Regression Coverage | Touched Files | Status |
|---|---|---|---|---|---|---|
| BUG-001 | `pnpm dev:web` intermittently throws a Vite overlay saying `Failed to resolve import "chess.js"` when `/dev/chatbridge` loads on a cold dependency-optimizer cache. | The web-only dev server should start without missing-module overlays, and the chess-backed ChatBridge surfaces should load cleanly on first open. | User report plus local reproduction from `pnpm dev:web` in `/private/tmp/chatbox-cb-003-parallel` and `/private/tmp/chatbox-chessjs-devfix`. | `src/electron.vite.config.test.ts` plus cold-start `pnpm dev:web` verification after clearing `node_modules/.vite`. | `electron.vite.config.ts`, `src/electron.vite.config.test.ts` | Fixed |
| BUG-002 | Renderer-only import/setup failures surface late as Vite overlays after the affected route renders. | `pnpm dev`, `pnpm test`, `pnpm check`, and `pnpm build` should stop immediately with a clear Node/install failure before Vite reaches route rendering when the worktree is stale or the shell is on the wrong Node major. | `/private/tmp/chatbox-cb-003-parallel` reproduced `pnpm run check/build` under Node v25.5.0, plus the reported Vite overlay for `chess.js` import resolution. | `test/integration/scripts/workspace-guard.test.ts` plus manual validation through `pnpm test`, `pnpm check`, and `pnpm build`. | `package.json`, `.erb/scripts/postinstall.cjs`, `scripts/workspace-guard.mjs`, docs/memory files. | Fixed |

## Validation Notes

- Focused regression: `pnpm exec vitest run src/electron.vite.config.test.ts`
- Additional verification: removed `node_modules/.vite`, started `pnpm dev:web`, confirmed the renderer came up without any `chess.js` import-analysis error, then verified `http://localhost:1212/dev/chatbridge` returned `200 OK`
- Additional verification: `pnpm install` records `node_modules/.chatbox-workspace-stamp.json`; `pnpm test`, `pnpm check`, and `pnpm build` now invoke `pnpm run guard:workspace` before the underlying toolchain.
- Focused regression: `pnpm vitest run test/integration/scripts/workspace-guard.test.ts`
- Full validation: `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build`, `git diff --check`
