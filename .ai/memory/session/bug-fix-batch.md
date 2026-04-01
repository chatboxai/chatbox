# Bug Fix Batch

Use this ledger only when a task is intentionally being handled as a bounded bug
batch.

| Bug ID | Symptom | Expected Behavior | Evidence Source | Regression Coverage | Touched Files | Status |
|---|---|---|---|---|---|---|
| BUG-001 | Renderer-only import/setup failures surface late as Vite overlays after the affected route renders. | `pnpm dev`, `pnpm test`, `pnpm check`, and `pnpm build` should stop immediately with a clear Node/install failure before Vite reaches route rendering when the worktree is stale or the shell is on the wrong Node major. | `/private/tmp/chatbox-cb-003-parallel` reproduced `pnpm run check/build` under Node v25.5.0, plus the reported Vite overlay for `chess.js` import resolution. | `test/integration/scripts/workspace-guard.test.ts` plus manual validation through `pnpm test`, `pnpm check`, and `pnpm build`. | `package.json`, `.erb/scripts/postinstall.cjs`, `scripts/workspace-guard.mjs`, docs/memory files. | Fixed |

## Validation Notes

- Focused regression: `pnpm vitest run test/integration/scripts/workspace-guard.test.ts`
- Additional verification: `pnpm install` records `node_modules/.chatbox-workspace-stamp.json`; `pnpm test`, `pnpm check`, and `pnpm build` now invoke `pnpm run guard:workspace` before the underlying toolchain.
- Full validation: `pnpm test`; `pnpm check`; `pnpm lint`; `pnpm build`; `git diff --check`
