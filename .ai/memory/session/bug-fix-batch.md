# Bug Fix Batch

Use this ledger only when a task is intentionally being handled as a bounded bug
batch.

| Bug ID | Symptom | Expected Behavior | Evidence Source | Regression Coverage | Touched Files | Status |
|---|---|---|---|---|---|---|
| BUG-001 | `pnpm dev:web` intermittently throws a Vite overlay saying `Failed to resolve import "chess.js"` when `/dev/chatbridge` loads on a cold dependency-optimizer cache. | The web-only dev server should start without missing-module overlays, and the chess-backed ChatBridge surfaces should load cleanly on first open. | User report plus local reproduction from `pnpm dev:web` in `/private/tmp/chatbox-cb-003-parallel` and `/private/tmp/chatbox-chessjs-devfix`. | `src/electron.vite.config.test.ts` plus cold-start `pnpm dev:web` verification after clearing `node_modules/.vite`. | `electron.vite.config.ts`, `src/electron.vite.config.test.ts` | Fixed |
| BUG-002 | `pnpm dev:web` crashes in the Electron main process with `Cannot read properties of null (reading 'allowReportingAndTracking')` during `initSentry()`. | Desktop bootstrap should tolerate stored `null` settings values by rehydrating defaults before any main-process consumer reads them. | User stack trace plus local reproduction from `pnpm dev:web` in `/private/tmp/chatbox-chessjs-devfix` after the chess resolver fix. | `src/main/store-node.test.ts` plus live `pnpm dev:web` startup verification against the existing user-data store. | `src/main/store-node.ts`, `src/main/store-node.test.ts` | Fixed |

## Validation Notes

- Focused regression: `pnpm exec vitest run src/electron.vite.config.test.ts`
- Additional verification: removed `node_modules/.vite`, started `pnpm dev:web`, confirmed the renderer came up without any `chess.js` import-analysis error, then verified `http://localhost:1212/dev/chatbridge` returned `200 OK`
- Full validation: `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build`, `git diff --check`
- Focused regression: `pnpm exec vitest run src/main/store-node.test.ts`
- Additional verification: started `pnpm dev:web`, confirmed the previous `initSentry()` null-settings crash no longer appeared, then verified `http://localhost:1212/dev/chatbridge` returned `200 OK`
