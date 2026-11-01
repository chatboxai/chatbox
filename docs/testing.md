# Testing Chatbox Community Edition

Use Node.js 22 and the pnpm version declared in `package.json`.

- `pnpm install --no-frozen-lockfile` installs dependencies.
- `pnpm check` generates routes and checks TypeScript.
- `pnpm lint` checks source with Biome.
- `pnpm test` runs deterministic Vitest suites. Provider suites require explicit opt-in.
- `pnpm build` builds main, preload, and renderer without packaging or signing.

Tests live beside source files and under `test/integration`. Prefer fixed fixtures, in-memory repositories, and fake model responses. Await asynchronous operations and clean up resources. Keep tests for storage revisions, migration, backup compatibility, and generation cancellation when changing those contracts.

Real provider tests are optional and require separately configured credentials and network access. Default unit tests must not call live providers. See package scripts for the available opt-in suites; record only checks actually executed.
