# WorkspAIce Project

For agents, not humans. Stable facts about this repo — edit only when these actually change (rare; see `AGENT_RULES.md` End-of-Task Checklist item 1). For current in-flight work see `STATE.md`; for non-obvious engineering gotchas see `ARCHITECTURE_NOTES.md`.

## Project Identity

- Repository name: WorkspAIce.
- Origin: fresh fork of an existing GPLv3 desktop AI client (Chatbox).
- License: GPLv3. The fork is intended to remain under GPLv3 if released.
- User intent: personal/non-commercial redesign and refactor into the app experience the user wants.

## Product Goals

- End goal: local-first desktop app for macOS and Windows.
- Keep user-configured providers, including local providers and user-supplied external API providers.
- Remove bundled/upstream hosted services.
- Remove all license, subscription, premium, account, and paid service flows.
- Remove telemetry/analytics and hosted remote configuration.
- Preserve GPLv3 compliance.
- Prefer thoughtful, incremental refactors over broad rewrites.
- Build a foundation where AI agents can collaborate across sessions using `.ai/` as shared memory.
- The user expects agents to inspect the codebase before making assumptions and to implement practical changes when asked.

## Project-Specific Guardrails

Generic workflow rules (branch, commits, pushing, ambiguity) live in `AGENT_RULES.md`. These are the repo-specific ones:

- Use existing patterns unless intentionally redesigning them.
- Before changing UI, identify the relevant renderer components and theme tokens (see Design Surface Inventory below).
- Before renaming internal identifiers, check for persisted data, app protocols, database paths, update endpoints, or external integrations.

## Tech Stack

- Runtime/app shell: Electron, Electron Vite.
- Frontend: React 18, TypeScript.
- Routing: TanStack Router, generated route tree.
- UI libraries: Mantine 7, MUI 5, Tailwind utilities, Emotion.
- State/data: Jotai, Zustand-style stores, TanStack Query, local persistent storage.
- Formatting/linting/typecheck: Biome, TypeScript.
- Package manager: pnpm.
- Node engine: `>=22.12.0 <25.0.0`.
- pnpm engine: `>=10.17.0`.

## Useful Commands

- Start desktop dev app: `pnpm dev` or `pnpm start`.
- Build: `pnpm build`.
- Typecheck: `pnpm check`.
- Test: `pnpm test`.
- QA unit tests: `pnpm qa:unit`.
- QA integration tests: `pnpm qa:integration`.
- QA coverage: `pnpm qa:coverage`.
- QA skipped-test audit: `pnpm qa:no-skipped`.
- QA biome diagnostic-count ratchet: `pnpm qa:biome-ratchet` (repo-wide; baseline in `scripts/qa/biome-baseline.json`; `--update-baseline` after intentional reductions).
- QA Electron E2E: `pnpm qa:e2e`.
- Full QA CI contract: `pnpm qa:ci`.
- macOS release/package smoke: `pnpm qa:release:mac`.
- Windows release/package smoke: `pnpm qa:release:win`.
- Lint: `pnpm lint`.
- Biome check: `pnpm check:biome`.
- Format: `pnpm format`.
- Use Homebrew Node 22 for project commands when the default shell Node is outside the engine range: `PATH="/opt/homebrew/opt/node@22/bin:$PATH" <command>`.

## Key Project Structure

- `src/main/`: Electron main process, updater, deep links, storage, OAuth, file parsing, local services.
- `src/preload/`: Electron preload bridge.
- `src/renderer/`: React renderer app and all primary UI.
- `src/renderer/routes/`: TanStack Router route components.
- `src/renderer/routes/__root.tsx`: root app shell, providers, Mantine theme, MUI theme provider, sidebar layout, global modals.
- `src/renderer/static/globals.css`: global design tokens and Mantine color variable mapping.
- `src/renderer/static/index.css`: global base styles, scrollbar styles, safe-area behavior, fonts.
- `src/renderer/Sidebar.tsx`: primary navigation, app branding, chat/task session list, bottom nav links.
- `src/renderer/components/layout/Header.tsx`: chat route header.
- `src/renderer/components/layout/Page.tsx`: generic page shell.
- `src/renderer/components/session/`: session list and session item UI.
- `src/renderer/components/chat/`: message list, messages, loading/status/navigation.
- `src/renderer/components/InputBox/InputBox.tsx`: large composer/input component. Change carefully.
- `src/renderer/routes/settings/`: settings pages.
- `src/renderer/routes/image-creator/`: image generation UI.
- `src/renderer/stores/session/`: chat orchestration, context building, tool assembly, stream chunk processing.
- `src/renderer/packages/mcp/`: MCP client/controller.
- `src/renderer/packages/skills/`: skills controller (renderer-side IPC stubs).
- `src/main/skills/`: skills IPC handlers (discovery, load, script execution).
- `src/main/chat-search/`: FTS5 chat-search index (db + IPC); renderer sync in `src/renderer/stores/chatSearchIndexing.ts`.
- `electron-builder.yml`: desktop packaging metadata.
- `package.json`: package metadata and scripts.
- `README.md` and `doc/`: project documentation.

## Design Surface Inventory

- Theme tokens: `src/renderer/static/globals.css`.
- Mantine theme/component defaults: `src/renderer/routes/__root.tsx`.
- MUI theme integration: `src/renderer/hooks/useAppTheme` and MUI provider usage in `routes/__root.tsx`.
- Base font and scrollbars: `src/renderer/static/index.css`.
- Primary navigation and branding: `src/renderer/Sidebar.tsx`.
- Chat header: `src/renderer/components/layout/Header.tsx`.
- General page shell: `src/renderer/components/layout/Page.tsx`.
- Session list: `src/renderer/components/session/SessionList.tsx` and `SessionItem.tsx`.
- Chat messages: `src/renderer/components/chat/MessageList.tsx`, `Message.tsx`, `SummaryMessage.tsx`.
- Composer: `src/renderer/components/InputBox/InputBox.tsx` plus subcomponents in the same folder.

## Redesign Approach

The standing direction for any redesign work (sequence agents have followed and should keep following):

1. Visual direction and design tokens first (palette/theme — see `ARCHITECTURE_NOTES.md` Branding State).
2. Then app shell: `Sidebar.tsx`, `Header.tsx`, `Page.tsx`, session list items.
3. Then chat surface: `MessageList.tsx`, `Message.tsx`, composer in `InputBox.tsx`.

What's actually done vs. outstanding is tracked in `STATE.md`, not here — this section only records the intended order.
