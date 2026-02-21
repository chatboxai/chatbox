# Repository Guidelines

## Project Structure & Module Organization
- `src/main`: Electron main process, IPC handlers, updater, and desktop integrations.
- `src/preload`: preload bridge between main and renderer.
- `src/renderer`: React UI (routes, pages, stores, packages, styles, static assets).
- `src/shared`: cross-process types, model/provider logic, and shared utilities.
- `test/integration`: end-to-end style integration suites (`file-conversation`, `model-provider`, `context-management`).
- `test/cases`: fixtures used by integration/manual tests.
- `assets`, `icons`, `resources`: packaged assets; `doc` and `docs`: documentation.

## Build, Test, and Development Commands
- Use Node `20.x`-`22.x` and `pnpm` (see `.node-version`, `engines`, and `pnpm-lock.yaml`).
- `pnpm install`: install workspace dependencies.
- `pnpm dev` (alias of `pnpm start`): run Electron app in development.
- `pnpm dev:web`: run web-only development mode.
- `pnpm build`: production build with `electron-vite`.
- `pnpm package`: build and package installer for current platform.
- `pnpm package:all`: package installers for macOS, Windows, and Linux.
- `pnpm check`: TypeScript type-check (`tsc --noEmit`).

## Coding Style & Naming Conventions
- Primary language: TypeScript (`strict: true`).
- Formatting and linting: Biome (`pnpm format`, `pnpm lint`, `pnpm check:ci`).
- Style defaults: 2-space indentation, single quotes, no semicolons, 120-char line width.
- Naming patterns: components/pages use `PascalCase.tsx` (example: `PictureDialog.tsx`), utilities/stores use `camelCase` filenames (example: `provider-config.ts`), and domain folders commonly expose `index.ts`.

## Testing Guidelines
- Test framework: Vitest (`vitest.config.ts`), Node environment with globals enabled.
- `pnpm test`: run all tests; `pnpm test:watch`: watch mode; `pnpm test:coverage`: coverage report.
- `pnpm test:integration`: run integration suites in `test/integration`.
- Test file names: `*.test.ts` / `*.test.tsx`; use `.integration.test.ts` for integration-heavy paths.
- Keep reusable fixtures in `test/cases`; colocate unit tests with source when practical.

## Commit & Pull Request Guidelines
- Follow observed commit style: `feat:`, `fix:`, `chore:`, `build:`; optional scopes like `feat(chat): ...`.
- Keep commit subjects imperative and concise; include issue/PR refs when relevant (example: `(#572)`).
- Complete `.github/PULL_REQUEST_TEMPLATE.md` for every PR.
- Include a clear change description, optional screenshots for UI changes, and required contributor-agreement checkbox.
