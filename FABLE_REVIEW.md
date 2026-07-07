# FABLE_REVIEW.md — WorkspAIce App Review

**Date:** 2026-07-02
**Reviewer:** Claude Fable 5 (read-only review; no code changed)
**Scope:** Full Electron app — main process, preload, renderer, packaging, security posture, UI/UX
**Verified during review:** `pnpm check` ✅ clean · `pnpm qa:unit` ✅ 1,099/1,099 pass (5.4s) · full `biome check` ❌ 120 errors / 840 warnings (see Code Quality) · app launched via `pnpm dev:web` with isolated `WORKSPAICE_E2E_USER_DATA_DIR` and inspected manually

This document is written for future LLM/coding agents. Every recommendation names files and is scoped so it can be turned into a task directly. Read `.ai/AGENT_RULES.md`, `.ai/PROJECT.md`, `.ai/ARCHITECTURE_NOTES.md`, and `.ai/STATE.md` before acting on anything here — they are the source of truth and already track several items below as known limitations.

---

## 0. Implementation Status

_Last updated 2026-07-02 (branch `dev`). Findings below are the original snapshot; resolved IDs are marked ✅ inline in §5. `.ai/STATE.md` is the live tracker — start there. Full history is in `git log` / `CHANGELOG.md`._

**Completed (all shipped with full `pnpm qa:ci` green — 1,118 unit + 37 integration + 7 E2E):**

- **P0 — Phase 1 hygiene sweep:** SEC-4 ✅ · PROD-1 ✅ · STAB-1 ✅ · DOC-1 ✅
- **§8 cleanups:** §8.1 dead deps — `react-router-dom`, `swr`, `javascript-obfuscator`, `web-vitals` ✅ (the `store` / `material-ui-popup-state` / `react-swipeable-views` audit is still open) · §8.2 dead code — App Store rating flow + `trackEvent`/`trackGenerateEvent` ✅ (Sentry-shim shrink still open) · §8.3 biome safe-autofix + repo-wide diagnostic ratchet (`qa:biome-ratchet`, baseline 0 errors / 826 warnings) ✅ · §8.10 stale docs deleted ✅
- **P1 — Security spine (part):** SEC-1 ✅ — implemented as a native **approval ledger** (`src/main/mcp/approval-ledger.ts`), which is stronger than the "resolve-by-id" minimal version below: the renderer can also write the settings blob, so a fingerprint-gated native confirmation is the real trust anchor while `webSecurity` is off. See `.ai/ARCHITECTURE_NOTES.md`.
- **Low-risk hardening batch:** SEC-7 ✅ (sed passed as a single shell-escaped arg) · STAB-2 ✅ (`parseJsonArg` guard on the `setStoreValue`/`setAllStoreValues`/`ensureShortcutConfig`/`ensureProxy` handlers — zod-validating high-value channel payloads is still open) · STAB-3 ✅ (`getDeviceName` async `execFile`) · §6.6 ✅ (skills script SIGTERM→SIGKILL escalation, resolve on `close`) · §8.9 ✅ (9 dead `.erb/scripts` removed, biome baseline ratcheted to 0/824).
- **P1 — SEC-2 ✅ (2026-07-02):** Electron 35.7.5 → 42.5.0 (Chromium 148, Node 24). Kept electron-builder 26.8.1 + the NPM-collector patch (unchanged, re-verified: mac arm64 asar complete). Two upgrade-induced fixes: `.erb/scripts/postinstall.cjs` now downloads the Electron dist (E42 removed the postinstall download), and `store-node.ts` became lazily initialized via `initStore()` because E42's `safeStorage.isEncryptionAvailable()` is false pre-ready — the old module-load init silently disabled config encryption (and would have wiped an existing encrypted config via `clearInvalidConfig`). Verified: `qa:ci` green, `qa:release:mac` packaged-app safeStorage round-trip. `qa:release:win` smoke deferred by user — run before the next Windows release.
- **P2 — SEC-3 ✅ (2026-07-03):** `webSecurity: true`. All cross-origin renderer HTTP now flows through a main-process streaming fetch proxy: `src/main/net-proxy.ts` (pull-based `net-proxy:fetch`/`read`/`abort` IPC over `session.defaultSession.fetch`, so the user proxy setting still applies; http/https only; per-sender stream scoping; idle-timeout + navigation/destroy reaping) + a desktop-only global-fetch override installed at renderer boot (`src/renderer/setup/net_proxy_fetch.ts`). Implemented as a global override rather than the per-adapter custom-`fetch` injection suggested in §7.3 — one choke point covers all 27+ provider definitions, `utils/request.ts`, web search (`ofetch`), model registries, and the MCP StreamableHTTP transport, and a missed call site degrades to a CORS error instead of an exfiltration hole. `connect-src` tightened from `*` to `'self' data: blob:` (+ localhost HMR in dev). Bonus finding during verification: Chromium treats a `file://` document as same-origin with **all** `file:` URLs, so even with webSecurity on the packaged renderer could still `fetch('file:///…')` any local file — now blocked via an `onBeforeRequest` rule cancelling programmatic (`xhr`/`other`) `file:` subresource requests. SEC-8 (`'unsafe-eval'` in prod CSP) remains open. Verified: `qa:ci` green + manual packaged-app probe (cross-origin fetch streams in 2 chunks through the proxy, POST headers/body round-trip, `file://` fetch and cross-origin XHR both blocked, abort propagates).
- **P2 — SEC-8 ✅ (2026-07-03):** prod CSP drops `'unsafe-eval'` — and fixed a bigger latent hole found during verification: the `onHeadersReceived` CSP header **never applies to the packaged `file://`-loaded window**, so packaged builds ran with *no CSP at all*. Production CSP is now a build-time `<meta>` tag (`injectDesktopProdCsp` in `electron.vite.config.ts`, desktop builds only, first tag in `<head>`), with `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'` — the wasm allowance is required by shiki's oniguruma engine (code highlighting), found via bundle analysis before flipping the switch. Dev keeps `'unsafe-eval'` via the header (Vite HMR). E2E loads the built renderer over `file://`, so the 7 zero-console-error E2E scenarios now regression-test the prod CSP on every `qa:ci`. Verified: `qa:ci` green + packaged-app probe with a local mock OpenAI provider (eval/`new Function` → `EvalError` from real page scripts; wasm compiles; streamed reply renders shiki-highlighted code, katex, and mermaid; zero CSP console errors). Probe gotcha for future agents: DevTools/Playwright `evaluate` bypasses CSP eval enforcement — test from an async page script. See `.ai/ARCHITECTURE_NOTES.md`.
- **P2 — SEC-5 ✅ (2026-07-03):** no `node-fetch@2` ships or loads anymore. Fix is packaging-layer only (no `src/` changes): `.erb/scripts/patch-mastra-rag.cjs` (called from `ensure-app-deps.cjs` beforePack) makes `@mastra/rag`'s eager `require('zeroentropy')` lazy in `dist/index.cjs`, strips the dep from its manifest, and deletes the package — its only consumer (`ZeroEntropyRelevanceScorer`) is never used by WorkspAIce. `release/app/package.json` drops the direct `node-fetch@2.7.0` pin (plus the `tr46`/`webidl-conversions`/`whatwg-url` relics from the pre-NPM-collector era) and adds `"overrides": {"node-fetch": "3.3.2"}`, forcing the one remaining declared dependent — the never-loaded `@mastra/core`→otel→GCP→`gaxios` chain (0 modules in the startup probe) — onto the CVE-fixed v3 that `@libsql/hrana-client` already ships. Unknown-structure on a future `@mastra/rag` bump is a HARD packaging failure by design. Verified: `qa:ci` green · packaged startup module probe (`zeroentropy`/`node-fetch`/`whatwg-url` all 0 loaded) · asar audit (single `node-fetch@3.3.2`) · `MDocument` chunking functional test against the patched bundle · SEC-8 mock-provider E2E smoke. See `.ai/ARCHITECTURE_NOTES.md`.

- **P2/Phase-4 — quick UX wins ✅ (2026-07-04):** §9.1 a11y labels — every icon-only control now has an `aria-label` (sidebar collapse, small-screen settings/about, the sidebar-expand/menu button in `Header.tsx`/`Page.tsx`/`task/$taskId.tsx`, all composer icon-row buttons, the send/stop button, the dev theme switch) · §9.3 — the token counter is now a labelled real `<button>` (was a clickable `Flex` div); hover-menu targets (attachment/MCP/KB) got aria-labels rather than Tooltips since their 100ms-hover dropdowns already self-describe and a Tooltip would race them · §9.9 — `atomFamily` migrated from deprecated `jotai/utils` to the `jotai-family` package (2 families, drop-in), boot deprecation warning gone. Verified via live a11y-tree audit (0 unnamed buttons, desktop + mobile), menus/token-popover still open, `qa:ci` gates green, biome baseline ratcheted 824 → 819.

- **P2 — §6.3 tool-error unification ✅ (2026-07-04):** all toolsets now report infrastructure failures by throwing; the AI SDK v6 turns throws into `tool-error` parts, forwards the message to the model, and continues the loop. `normalizeToolSetErrors` in `tools-builder.ts` is the assembly-boundary safety net (non-Error throws wrapped, returned `Error` values — the legacy MCP pattern that serialized to `{}` — converted to throws, aborts untouched). MCP controller's return-err hack removed (stale pre-v6 comment); sandbox/file/KB error strings and skills `{error}` guards became throws; script exit≠0 and abort-cancel stay structured results. Persisted error shape unified to `{error: string, errorCode?, input, toolName}` in both `stream-chunk-processor.ts` and `abstract-ai-sdk.ts` (which previously persisted stack traces and an object shape the UI couldn't render). See `ARCHITECTURE_NOTES.md`.

- **Low/opportunistic tier ✅ (2026-07-05):** §8.5 `WorkspAIceAIAPIError` → `CodedError` rename (incl. component + relic type) · §8.2 Sentry shim collapsed to a single shared no-op (`src/shared/sentry-shim.ts`; ErrorBoundary now self-contained; unused `sentry` DI adapter removed) · §8.1 dep audit closed (`material-ui-popup-state` removed; `store` and `react-swipeable-views` verified in use) · §8.6 all five `biome-ignore-all` files narrowed to per-line justified suppressions (Mermaid `<explanation>` placeholder replaced; default-models `t()!` fixed properly) · §6.4 all 49 `noFloatingPromises` resolved via explicit `void` (+1 justified suppression in ErrorTestPannel); biome baseline ratcheted 819 → 769 · bonus: broken `delete-sourcemaps` npm script repaired (runner file never existed; underlying script imported removed webpack config).

- **§6.2 + §7.6 + `qa:release:win` smoke ✅ (2026-07-06):** §6.2 — high-value IPC payloads (`skills:*`, `sandbox:*`, `mcp:stdio-transport:*`) are now zod-validated main-side via `src/main/ipc-payloads.ts`/`parseIpcPayload`; validation matches each handler's existing error channel (envelope handlers validate inside `try`, throw handlers let it propagate), schemas are shape-only (domain rules stay in the handlers), and `mcp:stdio-transport:create` now strips fields it never consumed. §7.6 — installed github/marketplace skills that ship a `scripts/` dir require explicit review before enabling: `discoverSkills` surfaces `SkillInfo.scriptNames`, the enable toggle opens `ScriptsReviewModal` (lazy-loads each script over the new read-only `skills:read-script` channel — same allowlist+realpath defenses as execute-script), and both install flows stopped auto-enabling script-bearing skills so review is the single choke point. Also ran the deferred `qa:release:win` smoke: NSIS `Setup.exe` builds, asar complete (601 pkgs, `node-fetch@3.3.2` only) — one-time fix was a corrupt cached `electron-v42.5.0-win32-arm64.zip` (delete + refetch). Verified: `qa:ci` green (1,167 unit + 37 integration + 7 E2E), biome at baseline (0/769). See `.ai/ARCHITECTURE_NOTES.md`.

- **P3 chat-surface phase ✅ (2026-07-07):** §8.4 InputBox split — all pure decision logic extracted to tested modules (`composerKeyboard` 18 tests · `sessionAttachmentDisplay` 15 · `composerSubmit` 12 · `composerInsertion` 11; `MessageInputField` moved to its own file; 2,072 → ~1,758 lines) · §8.7 MUI→Mantine on the chat leaves `Message.tsx`/`MessageErrTips.tsx`/`Attachments.tsx` with live-verified pixel parity (`Sidebar.tsx` `SwipeableDrawer` deliberately kept on MUI pending the mobile decision — no Mantine equivalent) · §9.2 settings responsiveness (shipped earlier in the phase) · composer token refresh (disabled-send bg, over-budget tint, no-model pulse now use `--workspaice-*` tokens; disabled send was previously light-gray even in dark mode) · §9.3 dismissible first-use toolbar hint (persisted `uiStore.composerHintDismissed`) · §9.5 disclaimer only renders while the session is empty · §9.7 capability-icon legend in `ModelList` (provider settings, fetch modal, import). Verified: `qa:ci` green, live light/dark + desktop/mobile checks on the isolated dev profile. See `ARCHITECTURE_NOTES.md` for the MUI→Mantine parity facts (breakpoint/typography/Grid/Tooltip equivalences).

- **Mobile+web drop ✅ (2026-07-07):** SEC-6 resolved by removing the mobile (Capacitor) and web build paths entirely (user decision — desktop-only product). 17 capacitor deps, `mobile_platform`/`web_platform`/Capacitor storage layers, mobile/web scripts and build branches removed (~3,600 lines); `PlatformType` narrowed to `'desktop'`; `Sidebar.tsx` + `ThreadHistoryDrawer.tsx` migrated off MUI `SwipeableDrawer` to Mantine. Small-screen responsive UI and RTL preserved. Verified: full `qa:ci` green.

- **F2 ⌘K command palette ✅ (2026-07-07):** global Spotlight palette (`CommandPalette.tsx`; store in a leaf module `commandPaletteStore.ts` to avoid an import cycle through `useShortcut`). Cmd/Ctrl+K opens the palette (was: search dialog); search moved to Cmd/Ctrl+Shift+F. Actions: new chat, create image, search all conversations, theme toggle, settings/provider settings, session switching. E2E scenario added; biome baseline ratcheted 769 → 682.

- **F1 onboarding + §9.4 ✅ (2026-07-07):** the previously-unmounted `Welcome` modal now shows on startup when no provider is configured ('Setup later' persists `uiStore.onboardingDismissed`; 'Setup Provider' re-prompts next launch until a provider exists). Empty state gets a provider-setup CTA; the composer's no-model tip points at provider setup when nothing is configured. New selectors `hasConfiguredProvider`/`useHasConfiguredProvider`. E2E fixtures dismiss the modal (proving it appears); dedicated empty-state scenario added.

- **F4 cross-session full-text search ✅ (2026-07-07):** main-process libsql FTS5 index (`src/main/chat-search/`, trigram tokenizer → case-insensitive substring matching incl. CJK, verified by 7 real-libsql unit tests). Renderer keeps IndexedDB as source of truth: debounced per-session sync hooked into `chatStore.updateSessionWithMessages`'s persist callback + delete hooks; one-time background backfill (version-namespaced meta flag). `searchSessions` global mode uses the index for queries ≥3 chars with hits re-verified against live blobs (identical match semantics); shorter queries / unready index fall back to the original scan. 6 new `chat-search:*` channels in the IPC allowlist. E2E: seed mock provider+model → send without response → global search finds it.

**Open — recommended order:**

1. **QA cycle:** §6.5 coverage on high-risk targets (KB/session-attachment RAG IPC mains, `InputBox.tsx`, `MessageList.tsx`, session CRUD).
2. **Maintenance:** electron-builder ≥26.13 upgrade (drop the app-builder-lib patch) + Electron 42.x patch bump.

---

## 1. Executive Summary

WorkspAIce is in solid shape for a 1.0.x-beta. The de-commercialization of the Chatbox fork is nearly complete and unusually disciplined: telemetry and Sentry are stubbed to no-ops, config is encrypted at rest via `safeStorage`, the preload bridge enforces an explicit IPC allowlist, skill/sandbox script execution is carefully path-validated, and the deterministic QA gate (typecheck + 1,099 unit + 37 integration + 7 E2E scenarios) is real and passing.

The three findings that matter most:

1. **The XSS → RCE chain is still open.** `webSecurity: false` (known, tracked) combined with the renderer-driven `mcp:stdio-transport:create` IPC handler means any script injection in the renderer can spawn an arbitrary process with arbitrary args/env. The CSP and allowlist shrink the injection surface but do not close this chain. Fixing it means either routing provider requests through the main process (re-enabling `webSecurity`) or constraining MCP spawn to main-process-persisted server configs — ideally both, in that order of effort/payoff.
2. **Electron 35 is past end-of-support.** Electron supports the latest three majors; 35 stopped receiving Chromium/V8 security patches when 38 shipped. For an app that renders LLM/tool/web-search-derived content with `webSecurity` off, running an unpatched Chromium is the single largest unowned risk. The upgrade interacts with the pinned `app-builder-lib@26.8.1` patch — see §7.
3. **One hosted-service remnant survived the purge:** `src/renderer/packages/edgeone.ts` (deploy-HTML-to-Tencent-EdgeOne) is still wired into `Markdown.tsx` and has its own success modal. This directly contradicts the local-first product rule in `.ai/AGENT_RULES.md` and should be removed.

Everything else is incremental: dead upstream code (App Store rating flow, no-op event tracking), four confirmed dead dependencies, a full-codebase lint debt of 120 errors that the changed-files-only `qa:biome` gate never burns down, oversized components (`InputBox.tsx` at 2,064 lines), and a set of cheap accessibility wins (icon-only buttons with no accessible names).

---

## 2. Current Project Understanding

- **What it is:** a local-first, GPLv3 desktop AI chat client for macOS/Windows, forked from Chatbox and being redesigned/de-commercialized. No hosted services, accounts, telemetry, or license flows are allowed; providers (OpenAI, Anthropic, Ollama, custom hosts, 27+) are user-configured.
- **Where it is:** version `1.0.2-beta` on branch `dev`. QA expansion is the active cycle; the chat-surface redesign (`MessageList.tsx`, `Message.tsx`, `InputBox.tsx`) has not started. Mobile (Capacitor) and web build paths still exist; their removal is an open product question in `.ai/STATE.md`.
- **How chat works:** single streaming loop per turn (`src/renderer/stores/session/orchestration.ts`) → `buildContext` → `buildToolsForSession` (MCP, web search, file, KB/session-attachment RAG, sandbox, skills) → `model.chatStream()` wrapping the `ai` SDK's `streamText()`, which internally handles multi-round tool-call exchange. Streaming state is persisted every 2s and finalized in `persistStreamingMessage`.
- **Skills:** two paths — model-driven (`load_skill`/`execute_skill_script` tools, effectively task-mode-only since regular chat doesn't pass `enabledSkillNames`) and deterministic `/slash` invocation that re-loads SKILL.md bodies each turn. Scripts execute in the main process with validated paths, scrubbed env, 30s timeout, 1MB output cap.
- **Sandbox:** `@anthropic-ai/sandbox-runtime` wraps shell commands (macOS Seatbelt / Linux / Windows-via-WSL2) with filesystem deny/allow lists; network is intentionally open.

---

## 3. Tech Stack Summary

| Layer | Tech |
|---|---|
| Shell | Electron **35.7.5** (⚠ past EOL), electron-vite 4, electron-builder 26.8.1 (**patched** — see `patches/`) |
| Renderer | React 18, TypeScript 5.8, TanStack Router (generated route tree) |
| UI | Mantine 7 (target) + MUI 5 (legacy, being migrated away) + Tailwind 3 + Emotion |
| State | Jotai + Zustand-style stores + TanStack Query (+ unused SWR) |
| AI | Vercel `ai` SDK v6 + `@ai-sdk/*` providers, `@mastra/*` (RAG/rerank only, exact-pinned), MCP SDK, `@anthropic-ai/sandbox-runtime` |
| Storage | electron-store (AES-256-CBC at rest, key in OS keychain via `safeStorage`), blob files, libsql vector DB |
| QA | Vitest 4 (unit/integration), Playwright `_electron` E2E, Biome 2 |
| Packaging | pnpm 10 workspace; `release/app` gets a **flat npm install** (`ensure-app-deps.cjs`) — npm ignores pnpm overrides, so version-coupled deps must be exact-pinned there |
| Mobile/web | Capacitor 7 (iOS/Android) + web build — fate undecided |

---

## 4. Strengths

- **Process security fundamentals are right:** `contextIsolation: true`, `nodeIntegration: false`, sandbox defaults pinned explicitly, preload exposes only a channel-allowlisted `invoke()` (`src/preload/index.ts` + `src/shared/ipc-channels.ts`, 107 channels), `setWindowOpenHandler` denies all in-page navigation, CSP blocks remote `<script>`/`<object>`/frames.
- **Secrets handling is thoughtful:** `store-node.ts` encrypts `config.json` with a keychain-protected random key, migrates plaintext configs non-destructively, and *purges legacy plaintext backups* that would otherwise leak API keys — a detail most apps miss.
- **Script-execution surfaces are defended in depth:** skills (`src/main/skills/ipc-handlers.ts`) validate names against strict patterns *and* realpath-prefix-check against the skills dir, scrub env, cap output; sandbox (`src/main/sandbox/manager.ts`) confines cwd, pipes untrusted file content via stdin instead of shell interpolation, kills process trees on timeout.
- **The QA contract is deterministic and honest:** no-skipped-tests gate, coverage floor, E2E against the real packaged Electron app; all green during this review.
- **Institutional memory works.** `.ai/ARCHITECTURE_NOTES.md` accurately documents genuinely non-obvious traps (the electron-builder pnpm-collector root cause, npm-vs-pnpm override coupling, `allowedDomains: ['*']` literal-match footgun). The previous `CODE_REVIEW.md`'s critical findings (plaintext keys, wildcard invoke proxy) were actually fixed, not just acknowledged.
- **De-commercialization is ~95% done** and done correctly: hosted services return errors or no-ops rather than being renamed into fake local services (`src/renderer/packages/remote.ts`).
- **Error handling at the orchestration boundary is complete:** abort vs. error paths both persist final message state; generation errors map to i18n-keyed user-facing codes.

---

## 5. Issues / Risks

Ordered by severity. "Known/tracked" = already in `.ai/` notes.

### 5.1 High

- ✅ **DONE (2026-07-02, approval-ledger approach — see §0)** — **[SEC-1] Renderer can spawn arbitrary processes via `mcp:stdio-transport:create`** (`src/main/mcp/ipc-stdio-transport.ts:36`). The handler accepts `command`, `args`, and `env` directly from the renderer and spawns it. Legitimate use is user-configured MCP servers, but combined with `webSecurity: false` this is the XSS→RCE escalation path: any injected script in the page has full network access *and* a process-spawning primitive. Mitigation options in §7.
- ✅ **DONE (2026-07-02, Electron 42.5.0 — see §0)** — **[SEC-2] Electron 35.7.5 is past end-of-support** (`package.json:201`). No more Chromium security patches. Upgrade to a supported major. Interacts with: the `app-builder-lib@26.8.1` patch pin, `electron-store@8` (v9+ is ESM), and the CJS main process. Plan as its own task with `qa:release:*` smoke tests.
- ✅ **DONE (2026-07-03, main-process net proxy — see §0)** — **[SEC-3] `webSecurity: false`** (`src/main/main.ts:353`). Known/tracked; the inline comment and CSP are good interim work. The durable fix (route provider `fetch()` through the main process, then re-enable) unlocks removing `'unsafe-eval'` pressure and downgrades SEC-1 from "RCE chain" to "defense in depth".

### 5.2 Medium

- ✅ **DONE (2026-07-02)** — **[SEC-4] `openLink` IPC and `setWindowOpenHandler` pass URLs to `shell.openExternal` with no scheme check** (`src/main/main.ts:421`, `main.ts:707`). A compromised renderer (or a crafted link in rendered markdown) can open `file://`, `smb://`, or protocol handlers of other apps. One-line fix: allowlist `http:`, `https:`, `mailto:`.
- ✅ **DONE (2026-07-02)** — **[PROD-1] EdgeOne hosted deploy still shipped** (`src/renderer/packages/edgeone.ts`, `deployHtmlToEdgeOne` imported by `components/Markdown.tsx`, plus `modals/EdgeOneDeploySuccess.tsx`). Sends user HTML artifacts to `https://mcp.edgeone.site`. Violates the local-first non-negotiable. Remove the button, the package, and the modal.
- ✅ **DONE (2026-07-03, packaging-layer patch — see §0)** — **[SEC-5] node-fetch@2.7.0 CVEs in packaged app** — known/tracked; root cause is eager `zeroentropy` loading via `@mastra/rag`. The long-term fix (lazy/scoped import) is described in `.ai/ARCHITECTURE_NOTES.md`. (Resolution: `patch-mastra-rag.cjs` lazifies + removes zeroentropy at pack time; npm override forces the residual never-loaded gaxios chain onto node-fetch@3.)
- ✅ **DONE (2026-07-02)** — **[STAB-1] Window creation is gated on knowledge-base init** (`src/main/main.ts:548`: `await knowledgeBaseInitPromise` before `createWindow()`). A hung/slow libsql init (corrupt DB, locked file) means *no window ever appears* and no user-visible error. Show the window first; let KB init resolve behind it (the renderer already tolerates async RAG readiness — see `refreshSessionAttachmentStatuses`).
- ✅ **DONE (2026-07-07, mobile+web build paths removed)** — **[SEC-6] Mobile SQLite `'no-encryption'`** — resolved by product decision: mobile (Capacitor) and web build paths were dropped entirely; the unencrypted mobile SQLite storage layer no longer exists. The same phase migrated `Sidebar.tsx`/`ThreadHistoryDrawer.tsx` off MUI `SwipeableDrawer` (→ Mantine `Drawer` + fixed aside) and removed the leftover hosted `report-content` flow, `DesktopDownloadReminder`, and the dead legacy `pages/SettingDialog`.

### 5.3 Low

- ✅ **DONE (2026-07-02)** — **[SEC-7] `editFile` sed escaping is incomplete** (`src/main/sandbox/manager.ts:289`): `escapeSedBRE` escapes BRE metacharacters but not `` ` `` or `"`, and the sed expression is wrapped in **double** quotes — a search/replace string containing a backtick triggers shell command substitution, and a `"` breaks the command. Fixed by building the sed program and passing it as a single `shellEscape`'d (single-quoted) argument, which neutralizes all shell metacharacters; BRE escaping retained for sed correctness.
- ✅ **DONE (2026-07-03, build-time meta CSP — see §0)** — **[SEC-8] CSP includes `'unsafe-eval'` in production.** Vite production bundles don't need eval; the comment attributes it to HMR and "some UI libraries". Test a packaged build without it (watch mermaid/shiki/katex) and split the CSP into dev vs. prod variants. (Resolution: prod CSP is a build-time `<meta>` tag — the header variant never applied to the `file://` window, so packaged builds previously had no CSP at all; `'wasm-unsafe-eval'` retained for shiki.)
- ✅ **DONE (2026-07-02)** — **[STAB-2] `setStoreValue`/`ensureProxy`/`ensureShortcutConfig` `JSON.parse` renderer input unguarded** (`src/main/main.ts:642+`) — malformed input threw back through IPC as an opaque error. Added a `parseJsonArg` helper that wraps the parse on those handlers plus `setAllStoreValues` and throws a channel-labelled error. (Zod-validating high-value channel payloads — §6.2 — is still open.)
- ✅ **DONE (2026-07-02)** — **[STAB-3] `getDeviceName` uses `execSync`** (`src/main/main.ts:687`) — blocked the main process; now uses async `execFile` (argv form, no shell).
- ✅ **DONE (2026-07-02)** — **[DOC-1] Stale root docs contradict reality:** `CODE_REVIEW.md` (2026-06-23) still lists "API keys stored in plaintext" and "wildcard invoke proxy" as open criticals — both fixed. `ERROR_HANDLING.md` describes an active Sentry integration — Sentry is now a no-op stub. Stale security docs are actively harmful to future agents; update or delete both.

---

## 6. Stability Improvements

1. **Un-gate window creation from KB init** ([STAB-1]) — biggest startup-robustness win, small diff in `main.ts`.
2. ✅ **DONE (2026-07-06, §6.2)** — **Add typed guards around IPC `JSON.parse` boundaries** ([STAB-2] ✅) and zod-validate high-value channel payloads (`skills:*`, `mcp:stdio-transport:*`, `sandbox:*`) in the main process — the preload allowlist controls *which* channels are callable, not *what* is sent. (Resolution: `src/main/ipc-payloads.ts` + `parseIpcPayload`; shape-only schemas, domain rules stay in the handlers. See §0 and `ARCHITECTURE_NOTES.md`.)
3. ✅ **DONE (2026-07-04, throw-based channel instead of the value envelope)** — **Unify the tool-error shape.** Known gap (`.ai/ARCHITECTURE_NOTES.md`): MCP returns caught errors as values, skills return `{success, stderr, exitCode}`, web/file tools throw or return error objects. A single `{ok, value|error}` envelope in `tools-builder.ts` wrappers would simplify `stream-chunk-processor.ts` and make model-visible errors consistent. (Resolution: unified on *throws* rather than returned envelopes — the AI SDK v6 forwards thrown tool errors to the model and continues the loop, and only the throw path drives the UI's red error state; returned envelopes would have rendered as green successes. See §0 and `ARCHITECTURE_NOTES.md`.)
4. **Burn down the 53 `noFloatingPromises` diagnostics** — these are the classic source of "nothing happened and nothing logged" bugs. Prioritize `src/renderer/stores/` and main-process files.
5. **Raise coverage on the named high-risk targets** from `.ai/STATE.md`: `src/main/store-node.ts` (backup/restore/encryption edge cases are exactly where data loss lives), KB/session-attachment RAG main paths, `InputBox.tsx`, `MessageList.tsx`, session CRUD.
6. ✅ **DONE (2026-07-02)** — **Watchdog for `skills:execute-script` and sandbox child leaks:** the skills timeout resolved the promise but the killed child's streams were abandoned. Now resolves on the child's `close` event, escalates SIGTERM→SIGKILL after a 3s grace, and clears its timers on settle. (Sandbox `execCommand` already had close-event accounting.)

---

## 7. Security Hardening Suggestions

In dependency order — each step makes the next cheaper:

1. **Scheme-allowlist `shell.openExternal`** ([SEC-4]). One shared `openExternalSafe(url)` helper in `main.ts` used by both call sites. ~20 lines, do first.
2. **Constrain MCP stdio spawn** ([SEC-1]). Minimal version: persist MCP server configs in the main-process store and change `mcp:stdio-transport:create` to accept a server *id*, resolving command/args/env main-side; the renderer settings UI already writes configs through `setSettings`, so the data is available. This closes renderer-supplied arbitrary spawn even while `webSecurity` is off. (The deep-link install flow already requires user confirmation via modal — good; keep that.)
3. ✅ **DONE (2026-07-03)** — **Route provider HTTP through the main process, re-enable `webSecurity`** ([SEC-3]). Implemented as a pull-based IPC stream (`net-proxy:fetch/read/abort`) + a desktop-only global-fetch override at renderer boot instead of per-adapter `fetch` injection — one choke point covers every call site, and `connect-src` tightened to `'self' data: blob:`. See §0.
4. ✅ **DONE (2026-07-02)** — **Electron upgrade to a supported major** ([SEC-2]). Re-verify: the `app-builder-lib` patch (pinned to 26.8.1 — check whether newer electron-builder fixed the pnpm collector, which would let you drop the patch), `electron-store@8` compatibility, `safeStorage` behavior, and run `qa:release:mac` + `qa:release:win`.
5. ✅ **DONE (2026-07-03)** — **Drop `'unsafe-eval'` from the packaged-build CSP** ([SEC-8]); kept dev-only. Delivered as a build-time `<meta>` tag with `'wasm-unsafe-eval'` for shiki — see §0.
6. ✅ **DONE (2026-07-06, §7.6 — script review)** — **Skill-install trust UX:** enabling a GitHub/marketplace-installed skill with a `scripts/` dir now opens `ScriptsReviewModal` showing each script's contents (lazy-loaded over the read-only `skills:read-script` channel), and install no longer auto-enables such skills so the review is the single choke point. (Not done: running skill scripts *through the sandbox runtime* instead of raw `spawn` — still a future hardening step; the existing name-allowlist + realpath-containment + scrubbed-env + timeout defenses remain.)
7. ✅ **DONE (2026-07-02)** — **Fix the sed escaping** ([SEC-7]): the sed program is now passed as a single `shellEscape`'d argument (the Node read→replace→write alternative was rejected because `execCommand`'s output is unconditionally truncated, which would corrupt large files).
8. ✅ **DONE (2026-07-03)** — **node-fetch CVE**: implement the tracked fix (scope the `@mastra/rag` import so `zeroentropy` isn't eagerly loaded at main startup), then drop `node-fetch` from `release/app`. Done at the packaging layer — see §0.

---

## 8. Code Quality Improvements

1. **Dead dependencies (verified unused in `src/`):** `react-router-dom` (TanStack Router is the router), `swr` (TanStack Query is the fetcher), `javascript-obfuscator` (no references anywhere, and obfuscation contradicts GPLv3 anyway), `web-vitals` (only the CRA-era `reportWebVitals.ts` stub). Remove from `package.json`; also audit `store`, `material-ui-popup-state`, `react-swipeable-views` (deprecated upstream) while there.
2. **Dead upstream code paths:** `packages/apple_app_store.ts` + `modals/AppStoreRating.tsx` — `tickAfterMessageGenerated()` is still called from `orchestration.ts:318` and can show an App Store rating modal in a non-App-Store GPLv3 fork; remove. `trackGenerateEvent` (`stores/session/utils.ts:24`) computes provider identifiers to feed a no-op `trackingEvent` — delete both. The Sentry shim/adapters can shrink to a single no-op module.
3. **Full-codebase lint debt: 120 errors / 840 warnings** (`biome check`). The CI gate (`qa:biome`) only checks *changed* files, so this never shrinks. Top rules: 244 `useAwait`, 111 `noNonNullAssertion`, 87 unused params, 83 `noExplicitAny`, 78 unorganized imports, 53 `noFloatingPromises`, 48 unused imports. Suggested mechanism: run `biome check --write` once for the safe autofixes (imports, `useConst`, templates), then add a ratchet (fail CI if total diagnostics increase) instead of a big-bang cleanup.
4. **Oversized components** (known/tracked): `InputBox.tsx` 2,064 lines, `$providerId.tsx` 1,236, `KnowledgeBaseDocuments.tsx` 1,030, `Message.tsx` 932, `SessionSettings.tsx` 899. Don't refactor opportunistically — `.ai/` rules say localized changes only — but when the chat-surface redesign starts, split `InputBox` by concern (attachments, slash-skills, model selector, send pipeline) with tests first.
5. **`WorkspAIceAIAPIError` rename** to a neutral local error mapper (`src/shared/models/errors.ts`) — already an open item in `.ai/STATE.md`; mechanical.
6. **Narrow the 4 `biome-ignore-all` files** (known/tracked) and give `Mermaid.tsx`'s `noDangerouslySetInnerHtml` suppression a real justification comment (`<explanation>` placeholder is still there).
7. **UI-stack consolidation (MUI→Mantine)** is already the standing direction; the practical next step is an inventory: `grep -rl "@mui/" src/renderer | wc -l` and migrate leaf components opportunistically during the chat redesign rather than as a standalone rewrite.
8. **Comment-language consistency:** main-process files mix Chinese and English comments. Fine functionally; translate opportunistically when touching a file (don't do a bulk pass — it pollutes blame).
9. ✅ **DONE (2026-07-02)** — **`.erb/` directory** still carries webpack-era scripts of which only a few (`ensure-app-deps.cjs`, `clean.js`, `notarize.js`, `patch-libsql.cjs`, `postinstall.cjs`, plus `check-native-dep.cjs` which `postinstall` requires) are live. Removed 9 dead scripts (`check-port-in-use.js`, `link-modules.*`, `electron-rebuild.*`, `check-native-dep.js` dup, `check-node-env.js`, `check-build-exists.ts`, `mocks/fileMock.js`) after a repo-wide reference grep. Note: `delete-source-maps.js` was left in place — the `delete-sourcemaps` npm script points at a non-existent `delete-source-maps-runner.js`, a pre-existing breakage; decide rename-vs-remove when next touching build scripts.
10. **Delete or refresh stale root docs** ([DOC-1]): `CODE_REVIEW.md`, `ERROR_HANDLING.md`.

---

## 9. UI/UX Improvements

Observed on the running app (dev-web mode, light inspection) plus code reading:

1. ✅ **DONE (2026-07-04)** — **Icon-only buttons lack accessible names.** In the a11y tree, the sidebar collapse, settings-gear, and all four composer action buttons expose no name (`button` with no label). Add `aria-label` + Mantine `Tooltip` — helps screen readers *and* discoverability of the composer's icon row. (Sidebar's "New Workspace"/"Search"/"Clear Conversation List" are correctly labeled, so the pattern exists.) (Resolution: aria-labels everywhere; Tooltips only where they don't race a hover-triggered menu — see §0.)
2. **Settings three-pane layout overflows horizontally** below ~700px width; the provider detail pane is clipped and requires horizontal scrolling. Collapse to two panes (or stacked navigation) under a breakpoint.
3. ✅ **DONE (2026-07-04, labels + real-button token counter)** — **Composer icon row is opaque to new users** — four unlabeled icons + a "0" counter (token estimate?) with no explanation. Tooltips (see #1) plus a first-use hint would fix this cheaply.
4. **Empty state could do more work.** "What can I help you with today?" is fine, but with no provider configured the first-run experience should point at provider setup (see feature F1). Currently a new user can type a message and only then discover nothing is configured.
5. **The persistent "AI-generated content may be inaccurate" disclaimer** costs a line of vertical space in every session forever. Consider showing it only for the first N sessions or moving it into the message-context area.
6. **Chat surface redesign** (`MessageList.tsx`, `Message.tsx`, `InputBox.tsx`) is already the tracked next design phase; the token order in `.ai/PROJECT.md` (tokens → shell → chat) has been followed, so this is unblocked.
7. **Provider settings model list**: capability icons (vision/tools/context) are dense hieroglyphics; a legend tooltip or column headers would help.
8. **Keyboard affordances**: `@mantine/spotlight` is already used for provider search — extend to a global ⌘K palette (see feature F2).
9. ✅ **DONE (2026-07-04)** — **Jotai `atomFamily` deprecation warnings** fire 8× in the console on boot — migrate to `jotai-family` before jotai v3 removes it (this is also future-stability).

---

## 10. Suggested New Features

Ordered roughly by value-to-effort. All are local-first-compatible (no hosted services).

| # | Feature | Notes |
|---|---|---|
| F1 | **First-run onboarding wizard** | Detect no configured provider → guided flow: pick provider → paste key / detect local → test call → first chat. Reuses existing provider settings forms. |
| F2 | **Global command palette (⌘K)** | `@mantine/spotlight` already a dep. Actions: switch/search sessions, new chat, change model, open settings pages, toggle theme. |
| F3 | **Local provider auto-discovery** | Probe `localhost:11434` (Ollama) / `1234` (LM Studio) / LlamaCpp defaults on the provider screen; one-click add. Pure local networking. |
| F4 | **Full-text search across all chats** | Sidebar search appears session-scoped; index message text in the existing libsql DB (FTS5) for cross-session search with hit highlighting. |
| F5 | **Local usage & cost dashboard** | `tokensUsed`/`usage` are already persisted per message. Aggregate per provider/model/day with user-editable price tables. No network. |
| F6 | **Side-by-side model comparison** | Send one prompt to 2–3 configured models in split panes. High demo value; orchestration already supports per-session model settings. |
| F7 | **Quick-capture window** | Global-shortcut mini composer from the tray (shortcut plumbing exists in `main.ts`); submits into a designated session. |
| F8 | **Prompt/template library with variables** | `{{variable}}` prompts, insertable from composer or ⌘K; complements the skills system for lighter-weight reuse. |
| F9 | **Knowledge-base folder watch** | Watch user-chosen directories and auto-(re)index changed files into the KB (chokidar in main process). Makes RAG maintenance-free. |
| F10 | **Full local backup/restore UI** | The 10-min config backup exists but is invisible. Settings page: list backups, restore point-in-time, export/import everything (sessions + settings + KB) as one archive. |
| F11 | **Per-workspace defaults** | Workspaces exist in the sidebar; give each a default model, system prompt, and enabled toolset. |
| F12 | **Skill testing panel** | The in-app skill editor exists; add a "dry run" that shows exactly what the model would receive (rendered SKILL.md + available scripts) and lets the user execute a script with args in isolation. |
| F13 | **Chat archive bulk export** | `export.ts` handles single sessions; add multi-select export (Markdown/JSON) wired into the existing bulk-selection actions from commit `6eaebc7e`. |
| F14 | **Theme accent customization** | Design tokens are centralized in `globals.css` + Mantine theme; expose accent-color and radius pickers in General Settings. |
| F15 | **Message pinning / bookmarks** | Pin important answers; a "pinned" filter per session and globally. Storage is a message flag + index. |

---

## 11. Recommended Fix Priority

| Priority | Items | Rationale |
|---|---|---|
| ✅ **P0 — DONE** | SEC-4 (openExternal allowlist) · PROD-1 (remove EdgeOne) · STAB-1 (un-gate window from KB init) · DOC-1 (stale docs) | Shipped 2026-07-02. |
| ✅ **P1 — DONE** | ✅ SEC-1 (MCP spawn constraint) · ✅ dead deps + dead upstream code (§8.1–8.2, partial — Sentry shim + 3-dep audit open) · ✅ biome ratchet (§8.3) · ✅ SEC-2 (Electron 35 → 42) | SEC-2 shipped 2026-07-02; win-package smoke ✅ 2026-07-06 (see §0). |
| ✅ **P2 — DONE** | ✅ SEC-3 (main-process provider proxy → `webSecurity: true`, 2026-07-03) · ✅ SEC-8 (prod CSP via build-time meta tag, 2026-07-03) · ✅ SEC-5 (node-fetch@2 stripped at pack time, 2026-07-03) · ✅ tool-error unification (§6.3, 2026-07-04) · ✅ a11y labels (§9.1, 2026-07-04 with §9.3/§9.9) | All P2 items shipped — see §0. |
| ✅ **Hardening — DONE** | ✅ §6.2 (zod-validate high-value IPC payloads, 2026-07-06) · ✅ §7.6 (skill-install script review, 2026-07-06) | Last of the never-prioritized §6/§7 security leftovers — see §0. |
| ✅ **P3 — DONE (2026-07-07, except features)** | ✅ InputBox split · ✅ MUI→Mantine chat leaves (Sidebar drawer deferred with SEC-6) · ✅ settings responsiveness · ✅ §9.3/§9.5/§9.7 UX wins | Features F1/F2/F4 remain open — see §0. |

---

## 12. Suggested Implementation Phases

**Phase 1 — Hygiene sweep (1–2 sessions).** P0 items + dead dependency/code removal + `biome check --write` safe autofixes + ratchet script in `scripts/qa/`. Everything verifiable with existing `pnpm qa:ci`. Update `CODE_REVIEW.md`/`ERROR_HANDLING.md` or delete them.

**Phase 2 — Security spine (2–4 sessions).** MCP spawn-by-id refactor (main-side config resolution, keep renderer UI unchanged), then the Electron major upgrade with `qa:release:mac`/`qa:release:win` smoke and a re-verification of `patches/app-builder-lib@26.8.1.patch` (drop it if upstream fixed the pnpm collector). Record any new packaging gotchas in `.ai/ARCHITECTURE_NOTES.md`.

**Phase 3 — Provider proxy (3–6 sessions).** Main-process streaming fetch proxy (IPC or MessagePort), custom `fetch` injection into the `ai`-SDK adapters (`src/renderer/adapters/`, `src/shared/models/`), per-provider regression via `pnpm test:model-provider`, then flip `webSecurity: true`, tighten CSP, remove the big SECURITY comment in `main.ts`, and delete the corresponding Known Risk entries in `.ai/`.

**Phase 4 — Chat redesign + quick features (ongoing).** The tracked `MessageList`/`Message`/`InputBox` redesign, folding in a11y labels, MUI→Mantine leaf migrations, and F1 (onboarding) + F2 (palette) which touch the same surfaces.

Each phase is independently shippable; don't start Phase 3 mid-Phase-2.

---

## 13. Notes for Future Coding Agents

- **Read `.ai/` first, always.** `AGENT_RULES.md` (workflow + end-of-task checklist), `PROJECT.md` (facts), `ARCHITECTURE_NOTES.md` (traps — the packaging section will save you hours), `STATE.md` (in-flight work). This review intentionally did **not** modify `.ai/` (read-only engagement); when you pick up an item from here, add it to `STATE.md` "In Flight / Next Up" yourself.
- **Non-negotiables:** work on `dev`; never push unless explicitly asked; no hosted services/telemetry/accounts; scoped commits; `pnpm check` + `qa:*` before claiming done.
- **Node/pnpm:** prefix commands with `PATH="/opt/homebrew/opt/node@22/bin:$PATH"` if the shell Node is outside `>=22.12.0 <25`.
- **Packaging is the minefield.** `release/app` is a *flat npm install* that ignores pnpm overrides — version-coupled deps must be exact-pinned in `release/app/package.json`. The `app-builder-lib@26.8.1` patch is load-bearing; any electron-builder change requires re-verification. `--mac --arm64` alone does not constrain arch — also pass `-c.mac.target.arch=arm64`.
- **New IPC handlers must be added to `INVOKABLE_IPC_CHANNELS`** in `src/shared/ipc-channels.ts` or the preload bridge blocks them.
- **Never delete `{userData}/.config-key`** in a user's profile — the encrypted config becomes unreadable and regenerates empty.
- **For isolated manual testing:** set `WORKSPAICE_E2E_USER_DATA_DIR` to a temp dir before `pnpm dev:web` (it launches real Electron against real userData otherwise). The renderer is then also reachable at `http://localhost:1212` for browser-based inspection.
- **Verification baseline as of this review:** typecheck clean, 1,099 unit tests green, full-repo biome has 120 pre-existing errors (the CI gate only checks changed files — don't be surprised, and don't "fix" unrelated files into your diff).
- **Cross-references:** the severity items here use stable IDs (SEC-n / STAB-n / PROD-n / DOC-n); reference them in commits and `STATE.md` entries so later agents can map work back to this document.
