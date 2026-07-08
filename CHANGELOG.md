# Changelog

All notable WorkspAIce changes are tracked here.

## [1.0.3] - 2026-07-08

First non-beta release. The `-beta` designation has been dropped and the in-app BETA badge removed; macOS packages (arm64 + Intel) built for this version.

## [1.0.2-beta] - 2026-07-08

Final beta release, closing out the `1.0.x-beta` line.

### Security And Stability

- Removed the vulnerable `node-fetch@2` HTTP library from the packaged app entirely. It was shipped and loaded at startup by an unused rerank API client (`zeroentropy`, pulled in by the document-chunking library); that client is now stripped at packaging time, and the one remaining — never loaded — dependency path is forced onto the fixed v3 release. Document chunking (knowledge base and chat attachments) is unaffected.
- The packaged app now enforces a real Content-Security-Policy. The previous CSP was delivered as an HTTP response header, which never applies to the `file://`-loaded production window — so packaged builds effectively ran with no CSP. It is now injected into the built page itself at build time, and the production policy drops `'unsafe-eval'`: injected scripts can no longer use `eval()`/`new Function` at all (`'wasm-unsafe-eval'` is kept for the code-highlighting engine's WebAssembly). Verified end-to-end in the packaged app: eval blocked, code highlighting, math, and diagrams all render normally.
- Re-enabled Chromium's same-origin policy (`webSecurity`) in the app window — the largest remaining renderer hardening item. AI-provider and other cross-origin requests are now routed through a main-process streaming fetch proxy (with abort and user-proxy support) instead of being fetched directly from the page, so an injected script can no longer exfiltrate data to arbitrary hosts from the renderer. The Content-Security-Policy `connect-src` was tightened from `*` to same-origin accordingly.
- Blocked programmatic reads of local files from the app window (fetch/XHR to `file://`) — Chromium would otherwise allow them from the packaged app's `file://` context even with the same-origin policy on. Static app assets are unaffected.
- Upgraded Electron from 35 (end-of-support) to 42 (Chromium 148, Node 24), restoring Chromium security-patch coverage for the app shell.
- Fixed a config-encryption regression the Electron upgrade would otherwise have introduced: on Electron 42 the OS-keychain check reports unavailable until the app is ready, so the config store is now initialized after readiness. Without this, `config.json` (which holds provider API keys) would silently be written unencrypted — and an existing encrypted config would have been wiped on first launch.
- External links opened from the app (rendered markdown, `openLink`, in-page navigation) are now restricted to `http:`, `https:`, and `mailto:` URLs; other schemes are blocked and logged.
- The main window now appears immediately on launch instead of waiting for knowledge-base initialization — a slow or corrupt knowledge-base database can no longer prevent the app from opening.
- Launching a local (stdio) MCP server now requires a one-time native approval that shows the exact command; approved servers run silently afterwards, and editing a server's command/args/env re-prompts. This blocks a compromised renderer from silently spawning arbitrary processes.
- Sandbox file edits now pass the search/replace program as a single shell-escaped argument, so strings containing backticks or quotes can no longer break out of the command or trigger shell command substitution.
- Malformed JSON sent to the internal store, shortcut-config, and proxy handlers now returns a clear error instead of an opaque failure through the IPC bridge.
- Device-name lookup on macOS no longer briefly blocks the main process (moved from a synchronous to an asynchronous subprocess call).
- A skill script that ignores the 30-second timeout is now force-terminated (SIGTERM then SIGKILL) and reaped instead of being left running, and its result is finalized only after the process fully exits.
- Tool failures now surface consistently across all integrations (MCP, web search, knowledge base, file reading, sandbox, skills): the model receives a clear error message it can react to, and the chat UI shows the failed-tool state. Previously, a failed MCP tool call rendered as a successful call with an empty result, several tools reported errors as ordinary-looking text, and stack traces were persisted into chat history.

### Local-First Cleanup

- Removed the "Publish Webpage" button on HTML code blocks and the underlying EdgeOne integration — HTML artifacts are no longer sent to a third-party hosted service.
- Removed the inherited iOS App Store rating prompt, which was never applicable to this desktop fork.
- Removed the dead telemetry plumbing (`trackEvent`/`trackGenerateEvent`) — all tracking was already a no-op stub; nothing was ever sent.
- Dropped four unused dependencies (`react-router-dom`, `swr`, `javascript-obfuscator`, `web-vitals`) and the CRA-era `reportWebVitals` scaffold.

### Accessibility

- Every icon-only button now exposes a proper accessible name for screen readers and assistive tech (previously announced as an unnamed "button"): the sidebar collapse and expand/menu controls on all pages, the small-screen settings and about buttons, the composer's attachment, tools, knowledge-base, web-search, thread, and settings buttons, the token-usage counter, and the send/stop button.
- The composer's token-usage counter is now a real, keyboard-focusable button instead of a clickable text element.

### Maintenance

- Removed nine dead webpack/CRA-era build scripts from `.erb/scripts` and ratcheted the repo-wide Biome diagnostic baseline down to 0 errors / 824 warnings.
- Migrated the two `atomFamily` stores from jotai's deprecated built-in (slated for removal in jotai v3) to the `jotai-family` package — the deprecation warning no longer fires at startup. Dropped a set of unused imports along the way (Biome baseline now 0 errors / 819 warnings).
- Renamed the internal error-code mapper `WorkspAIceAIAPIError` to `CodedError` (and its message component to `CodedErrorMessage`) — it was never a hosted-API error class — and removed the relic `WorkspAIceAIModel` type.
- Collapsed the five leftover Sentry stub modules into a single shared no-op (`src/shared/sentry-shim.ts`), made the React `ErrorBoundary` a self-contained component, and removed the unused `sentry` adapter from the model-dependency injection.
- Removed the unused `material-ui-popup-state` dependency (completing the earlier dependency audit; `store` and `react-swipeable-views` are still genuinely used).
- Replaced all five whole-file lint-suppression directives with per-line suppressions carrying real justifications; the settings screen's default-model pickers lost their non-null assertions outright via a proper nullability fix.
- Marked every fire-and-forget promise call explicitly with `void` (49 sites across renderer startup, hooks, mobile platform, and main-process backup/worker paths) so unintentionally dropped promises can no longer hide; Biome baseline ratcheted down to 0 errors / 769 warnings.
- Fixed the broken `delete-sourcemaps` npm script (used by the web and mobile build paths): it pointed at a file that never existed, and the underlying script imported webpack-era config that was removed long ago. It now actually strips production sourcemaps from `release/app/dist`.
- The packaged desktop app no longer bundles sourcemaps or bundle-analysis reports: hidden production sourcemaps (app and node_modules) and the `stats.html` visualizer output are now excluded at packaging time, shrinking the macOS app archive from 313 MB to 160 MB (−49%). Verified with a full arm64 package build, an archive audit (zero map/stats files, all packages intact), and a packaged-app launch probe.

### Chat Organization

- Added multi-select mode for regular chats across workspaces and the ungrouped Chat section.
- Added bulk move to any workspace or back to Chat, preserving selected chat order at the top of the destination.
- Added confirmed bulk deletion with selected-count feedback and retry-safe partial failure handling.

## [1.0.1-beta] - 2026-06-23

Second WorkspAIce beta release, focused on workspace organization, release readiness, and making the beta state visible in the app shell.

### UI And Release Polish

- Added a compact red/orange `BETA` badge beside the WorkspAIce sidebar title so users have a persistent visual reminder that this is a beta build.
- Removed remaining hosted license, subscription, and WorkspAIce AI service labels from settings, defaults, exports, parser flows, image generation recovery, and locale scan surfaces.
- Renamed the desktop reminder dismissal setting to remove hosted-era licensing terminology.

### Local Dev And Settings Stability

- Guarded the Knowledge Base settings route on non-desktop renderers so local browser smoke tests show the unsupported state instead of calling the desktop-only controller.
- Cleaned up floating-promise warnings in the Knowledge Base settings page.

### Workspaces

- Added workspace folders to organize chats into named groups with create, rename, and delete.
- Added per-workspace new-chat button to create chats directly inside a workspace.
- Workspace rows support right-click/context-menu rename and destructive delete (deletes all contained chats).
- Chats can be moved between workspaces and the ungrouped "Chat" section via right-click menu or drag-and-drop.
- Workspaces appear above the Chat section in the sidebar; ungrouped chats remain under Chat.
- Workspaces stored in local storage; workspace membership stored in session metadata (IndexedDB on desktop, SQLite on mobile).

## [1.0.0-beta] - 2026-06-23

First WorkspAIce beta baseline after the original fork, including all cleanup, local-first changes, release fixes, and hardening completed through June 23, 2026.

### Fork Reset And Branding

- Rebranded the app and repository surface to WorkspAIce.
- Established WorkspAIce as a GPLv3, local-first desktop fork for macOS and Windows.
- Added `.ai/CONTEXT.md` and `.ai/AGENT_RULES.md` so AI agents can preserve project direction, workflow rules, risks, and verification notes across sessions.
- Reworked README content with WorkspAIce direction, provider model, GPL/fork credits, setup notes, and app icon banner.

### Local-First Product Cleanup

- Removed bundled hosted-service direction from startup, settings, provider registration, docs, and user-facing flows.
- Removed hosted telemetry initialization, hosted remote config initialization, hosted license reconciliation, and hosted update listeners from renderer startup.
- Replaced hosted remote API behavior with local-first stubs that return empty data or explicit local-only errors.
- Removed hosted provider settings routes and related component trees.
- Removed cloud service settings including built-in hosted MCP provisioning, hosted web search upsells, hosted search defaults, and error-reporting toggles.
- Made MCP custom-server only in runtime bootstrap, settings, and menu paths.
- Defaulted web search to user-configured providers: Bing, Tavily, BoCha, and Querit.
- Removed license, account, premium, subscription, hosted parser, copilot, hosted KB/RAG, hosted OAuth/login, and hosted plan upgrade surfaces.
- Removed auto-updater behavior, hosted CORS proxy URL, Artifact preview feature, seeded demo data, hosted remote config branching, and hosted referer headers.
- Blocked bundled hosted asset loads from persisted seeded sessions so old remote avatar/image URLs are treated as absent.


### UI, Theme, And Startup

- Applied the WorkspAIce four-color palette across renderer globals, Mantine bindings, MUI integration, scrollbars, and links.
- Replaced app icons across macOS, Windows, Linux, renderer, favicon, splash, tray, and mobile source surfaces with the WorkspAIce W + AI mark.
- Added deterministic icon regeneration via `scripts/regen-app-icons.mjs`.
- Removed the Getting Started/onboarding guide from startup, routes, session unions, sidebar/help navigation, and first-run prompts.
- Changed desktop startup to open a blank new-chat page at `#/` instead of restoring an old route/session.
- Changed new chat creation so it does not preselect the default or last-used chat model.
- Fixed provider icons by replacing the problematic Vite glob with explicit image imports.
- Removed remaining hosted trial/upgrade links from chat, file parse, knowledge base, image generation, and shared error flows.

### Providers And Model Behavior

- Preserved local and user-configured external providers while removing bundled hosted provider registration.
- Fixed local dev startup issues caused by hosted-service cleanup.
- Improved Ollama vision detection by using native `POST /api/show` capabilities when available.
- Tightened Ollama fallback vision-family detection and avoided broad false-positive `qwen3*` and small text-only `gemma3` matches.
- Kept manual model capability checkboxes supported.

### Landing Page

- Added a static `landing/` site with hero, provider, local-first, credits, and footer sections.
- Added light/dark theme support, mobile responsive layout, local assets only, and no external runtime dependencies.
- Added Docker/nginx deployment files with gzip and cache headers.
- Fixed landing page WCAG AA contrast and cache behavior.

### Packaging And Release Fixes

- Tagged and configured the first beta release as `v1.0.0-beta` / `1.0.0-beta`.
- Fixed v1.0.0-beta build configuration, release notes, and unsigned macOS/Windows packaging setup.
- Removed broken Windows signing configuration that referenced a missing signing script.
- Regenerated stale `pnpm-lock.yaml` entries so `release/app` production dependencies are represented correctly.
- Fixed macOS packaged-app crashes caused by missing runtime modules such as `electron-debug`, `protobufjs/minimal`, protobuf helper packages, and `whatwg-url`.
- Added required runtime and peer dependency closures to root and `release/app` manifests while the deeper packaging issue was diagnosed.
- Diagnosed the root cause of recurring packaged `Cannot find module` crashes: electron-builder 26's pnpm collector dropped deduplicated transitive subtrees from the asar.
- Added `patches/app-builder-lib@26.8.1.patch` so electron-builder tries the NPM collector first and packs the full flat dependency tree.
- Moved pnpm patch, override, and build-dependency configuration into `pnpm-workspace.yaml` because pnpm 10.33 ignores the `pnpm` field in `package.json`.
- Exact-pinned version-coupled `@mastra/core`, `@mastra/libsql`, and `@mastra/rag` in `release/app/package.json` to avoid npm install pulling incompatible versions.
- Verified rebuilt macOS arm64/x64 packages launch without the previous module resolution and `@mastra/libsql` crashes.

### Security Hardening

- Added a preload IPC allowlist in `src/shared/ipc-channels.ts` and blocked arbitrary `invoke()` channel access.
- Added Content Security Policy, `X-Content-Type-Options`, Referrer-Policy, and HSTS headers.
- Explicitly pinned `nodeIntegration:false` and `contextIsolation:true` in Electron webPreferences.
- Kept `webSecurity:false` for now because renderer-side provider API calls still require CORS-free access.
- Encrypted config/API keys at rest using electron-store plus Electron `safeStorage`, with a one-time plaintext migration and legacy backup purge.
- Restricted sandbox `cwd` handling to the sandbox root.
- Changed sandbox file writes to use stdin instead of shell interpolation.
- Added strict skill and script name validation before skill script execution.
- Standardized skills IPC install/delete/check-update failures into structured `{ success: false, error }` envelopes.
- Upgraded `tar` from `^4.4.19` to `^7.5.16` for CVE-2021-37712.
- Removed legacy Webpack and ESLint infrastructure that was no longer used by the Electron Vite/Biome workflow.
- Removed dead Sentry no-op calls and stale config atom code.
- Routed leftover `Mermaid.tsx` loading copy through i18n.

### Documentation And I18n

- Cleaned hosted-service references from docs, i18n locales, PRDs, and changelog translations.
- Updated technical docs around provider setup, tools/integrations, auto-updater removal, dependency reorganization, storage, and session attachment RAG notes.
- Updated `.ai/CONTEXT.md` with packaging root-cause analysis, security hardening notes, versioning state, and open risks.

### Verification Highlights

- TypeScript checks passed after major cleanup and hardening passes.
- `git diff --check` passed after cleanup/hardening work.
- `pnpm build` passed after the hardening pass.
- Playwright/CDP regression checks covered startup, settings, hosted-service removals, landing page behavior, theme behavior, and provider icons.
- macOS arm64/x64 packages were rebuilt and smoke-tested after packaged-app crash fixes.

### Known Remaining Risks

- `webSecurity:false` remains until provider API calls are routed through the main process.
- `node-fetch@2.7.0` remains in `release/app` because `zeroentropy` via `@mastra/rag` still needs it; no patched CJS-compatible 2.x release exists.
- Mobile SQLite still uses no encryption pending the mobile-support decision.
- Some broad Biome suppressions remain as cleanup follow-up work.
- `WorkspAIceAIAPIError` remains as dead hosted-era compatibility code in a few catch paths.
- Larger architecture work such as `InputBox.tsx` refactor, MUI to Mantine migration, and state management consolidation remains deferred.
