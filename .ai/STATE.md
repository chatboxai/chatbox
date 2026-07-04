# Current State

For agents, not humans. What's true right now. Edit in place after every task (see `AGENT_RULES.md` End-of-Task Checklist items 3-4) — when an item is fully resolved, delete it rather than leaving it as a historical note. History lives in `git log` and `CHANGELOG.md`, not here.

## Active Cycle

- Development version is `1.0.2-beta` (root and `release/app` manifests). Keep working under this version until the user explicitly says it's released, then move to `1.0.3-beta`.
- Last installed/verified local macOS build: `1.0.2-beta` (`CFBundleShortVersionString` confirmed, codesign valid, ad-hoc signed for local testing).

## In Flight / Next Up

- QA expansion is active. Deterministic gates now enforce no skipped tests, measure all production TypeScript, run 1,118 unit + 37 integration + 7 Electron E2E scenarios, and ratchet repo-wide biome diagnostics (`qa:biome-ratchet`, baseline 0 errors / 824 warnings — reduce opportunistically and ratchet down). Current coverage floor is 20% statements/lines and 15% branches/functions. Next highest-risk coverage targets: `src/main/store-node.ts`, knowledge-base/session-attachment RAG main-process paths, `InputBox.tsx`, `MessageList.tsx`, and session CRUD/messages.
- FABLE_REVIEW.md: **all P0/P1/P2 items are done** (security spine, provider proxy/CSP, §6.3 tool-error unification, §9.1/§9.3/§9.9 quick UX wins — see FABLE_REVIEW §0 for the ✅ list). Remaining: the low/opportunistic list below, P3 redesign-coupled items, and the SEC-6 mobile decision. A11y note for new UI: icon-only buttons must get `aria-label` (pattern: `SessionList.tsx`); don't wrap hover-triggered `Menu.Target` buttons in `Tooltip` — the dropdown races it. Tool-error convention for new toolsets: infrastructure failures throw; see ARCHITECTURE_NOTES.
- **SEC-2 follow-ups:** (1) `qa:release:win` smoke was deferred by the user — run it before the next Windows build/release. (2) Routine Electron 42→43 bump once 43.x has minors older than pnpm's 7-day `minimumReleaseAge` and has settled (42 support ends 2026-10-20). (3) Evaluate upgrading electron-builder (≥26.13 has an upstream pnpm-collector dedup fix, PR #9618) and dropping `patches/app-builder-lib@26.8.1.patch` — own task, needs the full `qa:release:*` + asar-completeness verification described in `ARCHITECTURE_NOTES.md`.
- Still open from the FABLE_REVIEW low/opportunistic tier: §8.5 `WorkspAIceAIAPIError` rename (mechanical but ~66 refs across 18 files incl. a component filename — own commit), §6.4 `noFloatingPromises` burndown, §8.2 Sentry-shim shrink, §8.1 remaining dep audit (`store`/`material-ui-popup-state`/`react-swipeable-views`), §8.6 `biome-ignore-all` narrowing. Note: `.erb/scripts` still has a pre-existing broken `delete-sourcemaps` npm script pointing at a non-existent `delete-source-maps-runner.js` (the real file is `delete-source-maps.js`) — left untouched, decide rename-vs-remove if you touch build scripts.
- Chat surface redesign (`MessageList.tsx`, `Message.tsx`, `InputBox.tsx`) — not started.
- `InputBox.tsx` refactor, MUI→Mantine migration, state management consolidation — deferred architecture work, no active owner.

## Open Product Questions

- Should mobile and web build paths be removed now or only deprioritized while desktop cleanup happens first?
- `WorkspAIceAIAPIError` class still exists in `src/shared/models/errors.ts` as a misnamed shared error-code mapper for local/provider/parser/search errors (hosted plan/quota/license entries already removed). Renaming it to a neutral local error mapper is a follow-up mechanical cleanup.
- Static landing site at `landing/`. Deployment is the user's responsibility (own infrastructure). Local container: `workspaice-landing`, port 8080, image `workspaice-landing:latest`.
- Mobile SQLite encryption and biome-ignore-all narrowing are tracked as known limitations — see `ARCHITECTURE_NOTES.md` Known Risk Areas for details, not duplicated here.
