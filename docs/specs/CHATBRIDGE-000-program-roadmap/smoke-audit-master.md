# ChatBridge Smoke Audit Master Ledger

## Purpose

This document is the canonical audit ledger for end-to-end ChatBridge smoke
testing after the reviewed-partner program closeout. It exists to capture what
actually works, what only works in tests or seeded demos, what regressed, and
what must be rebuilt as follow-up stories.

Use this ledger for:

- cross-pack smoke findings
- repro steps and expected versus actual behavior
- trace evidence from LangSmith
- likely owning pack and story
- follow-up story candidates

The post-queue initiative packet that picks up after the current rebuild lane
is:

- `docs/specs/CHATBRIDGE-001-post-rebuild-agent-productization/`

Do not treat a passing automated test as proof that the user-visible flow is
healthy. This ledger is specifically for closing the gap between story
completion and live product behavior.

## Audit Scope

- Runtime surface: ChatBridge inside Chatbox
- Packs in scope: Pack 03 through Pack 07
- Key apps in scope: Chess, Drawing Kit, Weather
- Legacy reference apps still present in historical traces: Debate Arena, Story Builder
- Verification modes:
  - scenario test runs
  - seeded-session manual checks
  - fresh-thread prompt-driven checks
  - LangSmith trace inspection

## Status Legend

- `confirmed`: reproduced and evidenced
- `suspected`: strong signal, not yet fully reproduced
- `fixed-during-audit`: found and corrected in this audit story
- `blocked`: could not be verified because a prerequisite failed

## Finding Template

### SA-XXX: Short title

- Status:
- Severity:
- Area:
- Owning pack:
- Likely owning story:
- Environment:
- Repro steps:
- Expected:
- Actual:
- Evidence:
  - test or manual surface:
  - trace id(s):
  - relevant code path(s):
- Notes:
- Follow-up story candidate:

## Findings

### SA-001: Default runtime catalog only exposes Chess

- Status: `confirmed`
- Severity: high
- Area: reviewed app discovery and default runtime behavior
- Owning pack: Pack 05
- Likely owning story: `CB-505`
- Environment: clean worktree `/private/tmp/chatbox-chessjs-devfix`, default app runtime
- Repro steps:
  1. Inspect `/private/tmp/chatbox-chessjs-devfix/src/shared/chatbridge/reviewed-app-catalog.ts`.
  2. Confirm the default reviewed catalog only contains the Chess entry.
  3. Compare a fresh-prompt Story Builder request against the default runtime selection path.
- Expected: a fresh reviewed-partner runtime should know about the scoped flagship apps needed for Pack 05 and Pack 06, not just Chess.
- Actual: the default runtime catalog only registers Chess. Story Builder and Debate Arena only exist when tests or seeded fixtures define extra catalog entries.
- Evidence:
  - test or manual surface:
    - `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && pnpm exec tsx <<'TS' ... getReviewedAppRouteDecision(...) ... createReviewedSingleAppToolSet(...) ... TS`
    - output for `Open Story Builder and continue my outline.` returned:
      - route: `kind: "refuse"`, `reasonCode: "no-eligible-apps"`
      - single-app selection: `status: "chat-only"`
  - trace id(s):
    - none for this direct static/runtime repro
  - relevant code path(s):
    - `/private/tmp/chatbox-chessjs-devfix/src/shared/chatbridge/reviewed-app-catalog.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/packages/chatbridge/router/decision.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/packages/chatbridge/single-app-tools.ts`
- Notes:
  - This means the scoped multi-app product is not actually available to a new user in the default runtime, even though it is modeled in tests and docs.
- Follow-up story candidate:
  - `CB-508` - Active reviewed catalog transition and legacy retention

### SA-002: Live prompt-driven app launch path is still Chess-only

- Status: `fixed-during-audit`
- Severity: high
- Area: live chat orchestration
- Owning pack: Pack 03 and Pack 05
- Likely owning story: `CB-506`
- Environment: clean worktree `/private/tmp/chatbox-chessjs-devfix`, default renderer generation path
- Repro steps:
  1. Inspect `/private/tmp/chatbox-chessjs-devfix/src/renderer/packages/model-calls/stream-text.ts`.
  2. Follow the tool construction path into `/private/tmp/chatbox-chessjs-devfix/src/renderer/packages/chatbridge/single-app-tools.ts`.
  3. Confirm that reviewed invoke selection now starts from the reviewed route
     decision and only falls back to a narrow natural-Chess helper when the
     route result would otherwise clarify.
- Expected: after Pack 05, reviewed app launch should be mediated through a real multi-app route/clarify/refuse path rather than a Chess-only shortcut.
- Actual:
  - the live `streamText(...)` path now records a reviewed route-decision event,
    mounts a host-owned reviewed tool for explicit Drawing Kit prompts, and
    normalizes the final returned result through the reviewed launch path
  - natural Chess prompts such as raw FEN plus "best move" remain launchable
    through a narrow Chess fallback when the reviewed router would otherwise
    stop at clarify
  - reviewed launch failures remain explicit host-tool errors instead of
    collapsing back into silent chat-only behavior
- Evidence:
  - test or manual surface:
    - `src/shared/chatbridge/single-app-discovery.test.ts`
    - `src/renderer/packages/chatbridge/single-app-tools.test.ts`
    - `test/integration/chatbridge/scenarios/live-reviewed-app-invocation.test.ts`
  - trace id(s):
    - `38c2a2bc-c130-45d1-9bb2-34cae03fe574`
      (`chatbridge.eval.chatbridge-live-reviewed-app-invocation-cb-506-doc-proof-active-drawing`)
    - `decc2258-ea15-4db5-8355-e4dd1d9f4986`
      (`chatbridge.eval.chatbridge-live-reviewed-app-invocation-cb-506-doc-proof-natural-chess`)
    - `a1ad56b1-d843-4e98-9be8-4dc258459dc4`
      (`chatbridge.eval.chatbridge-live-reviewed-app-invocation-cb-506-doc-proof-failure`)
  - relevant code path(s):
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/packages/model-calls/stream-text.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/packages/chatbridge/single-app-tools.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/shared/chatbridge/single-app-discovery.ts`
- Notes:
  - This gap is now closed for the live invoke seam without claiming that the
    later Drawing Kit, Weather Dashboard, or clarify/refuse UI stories are
    already complete.
- Follow-up story candidate:
  - continue the queue at `CB-509`

### SA-003: Route decisions and clarify/refuse artifacts are effectively test-only seams

- Status: `fixed-during-audit`
- Severity: high
- Area: route UX
- Owning pack: Pack 05
- Likely owning story: `CB-507`
- Environment: isolated worktree `/private/tmp/chatbox-cb-507`
- Repro steps:
  1. Search for runtime use of `getReviewedAppRouteDecision(...)` and `createReviewedAppRouteArtifact(...)`.
  2. Search for renderer use of `chatbridgeRouteDecision`.
  3. Confirm that the route artifact contract is exercised in tests but not rendered through a decision-specific live UI.
- Expected: ambiguous and chat-only cases should surface a live clarify/refuse artifact with actionable next steps in the chat UI.
- Actual:
  - the live `streamText(...)` path now injects clarify or refusal route
    artifacts into the assistant timeline whenever the reviewed route stays out
    of direct invoke
  - route receipts now render through a dedicated inline
    `ChatBridgeRouteArtifact` surface with explicit clarify choices, chat-only
    acknowledgement, refusal reasoning, and replay-safe resolved state
  - clarify choices reuse the existing reviewed launch adoption path and stale
    replays are rejected instead of launching another app
- Evidence:
  - test or manual surface:
    - `src/renderer/packages/model-calls/stream-text.test.ts`
    - `src/renderer/packages/chatbridge/router/actions.test.ts`
    - `src/renderer/components/chatbridge/ChatBridgeMessagePart.test.tsx`
    - `test/integration/chatbridge/scenarios/route-decision-live-artifacts.test.ts`
  - trace id(s):
    - `ae3f678e-5089-483b-b5e8-8076b5a79dcc`
      (`chatbridge.eval.chatbridge-route-decision-live-artifacts.cb-507-doc-proof-clarify`)
    - `efaa4331-7dc9-4984-a459-c6d0bad10b5f`
      (`chatbridge.eval.chatbridge-route-decision-live-artifacts.cb-507-doc-proof-refuse`)
  - relevant code path(s):
    - `src/renderer/packages/model-calls/stream-text.ts`
    - `src/shared/chatbridge/routing.ts`
    - `src/renderer/packages/chatbridge/router/actions.ts`
    - `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
    - `src/renderer/components/chatbridge/ChatBridgeRouteArtifact.tsx`
    - `src/renderer/components/chat/Message.tsx`
- Notes:
  - This gap is now closed for the active flagship runtime path. Ambiguous and
    chat-only prompts no longer disappear into plain assistant text or
    test-only helpers.
- Follow-up story candidate:
  - none; continue the queue at `CB-105`

### SA-004: Auth broker and resource proxy are not wired into the live runtime

- Status: `confirmed`
- Severity: high
- Area: authenticated app runtime
- Owning pack: Pack 06
- Likely owning story: `CB-605`
- Environment: clean worktree `/private/tmp/chatbox-chessjs-devfix`
- Repro steps:
  1. Search for `createChatBridgeAuthBroker(...)` and `createChatBridgeResourceProxy(...)` across runtime code.
  2. Compare usages in `src/main/**` and `src/renderer/**` against test usage.
- Expected: Story Builder auth, credential-handle lifecycle, and resource proxying should be reachable from live runtime code, not only from scenario fixtures.
- Actual: the auth broker and resource proxy are strongly implemented and tested, but their usages are confined to tests and scenario harnesses.
- Evidence:
  - test or manual surface:
    - `rg -n "createChatBridgeAuthBroker|createChatBridgeResourceProxy|authorizeAppLaunch|execute\\(" src/main src/renderer src/shared`
    - runtime hits are definition files and tests; there is no live orchestration path that invokes them from the renderer app surface
  - trace id(s):
    - none from a live user flow
  - relevant code path(s):
    - `/private/tmp/chatbox-chessjs-devfix/src/main/chatbridge/auth-broker/index.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/main/chatbridge/resource-proxy/index.ts`
    - `/private/tmp/chatbox-chessjs-devfix/test/integration/chatbridge/scenarios/story-builder-lifecycle.test.ts`
- Notes:
  - Story Builder cards render in seeded sessions, but the actual auth/save/resume mechanics are not wired as a live conversation feature.
  - After the 2026-04-02 active catalog change, this finding is parked as a
    legacy-app issue unless Story Builder returns to the active flagship set.
- Follow-up story candidate:
  - `CB-605` - Story Builder runtime auth and resource proxy integration

### SA-005: Bridge host controller is used for HTML artifact preview, not for ChatBridge app launches

- Status: `fixed-during-audit`
- Severity: high
- Area: bridge runtime
- Owning pack: Pack 02 and Pack 03
- Likely owning story: `CB-305`
- Environment: clean worktree `/private/tmp/chatbox-chessjs-devfix`
- Repro steps:
  1. Search for `createBridgeHostController(...)` in runtime code.
  2. Compare actual usages against expected reviewed-app launch surfaces.
- Expected: the reviewed embedded-app bridge should be the live runtime seam for app launches and state updates.
- Actual:
  - reviewed host-tool launches are now normalized into real ChatBridge `app`
    parts and rendered through
    `/private/tmp/chatbox-chessjs-devfix/src/renderer/components/chatbridge/apps/ReviewedAppLaunchSurface.tsx`
  - the reviewed launch surface starts the bridge host controller, persists
    bootstrap/ready/state/recovery through host-owned session records, and
    leaves `/private/tmp/chatbox-chessjs-devfix/src/renderer/components/Artifact.tsx`
    on the explicit HTML-preview seam only
- Evidence:
  - test or manual surface:
    - `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && pnpm exec vitest run src/renderer/packages/chatbridge/reviewed-app-launch.test.ts src/renderer/packages/chatbridge/bridge/reviewed-app-runtime.test.ts src/renderer/components/chatbridge/apps/ReviewedAppLaunchSurface.test.tsx src/renderer/components/Artifact.test.tsx test/integration/chatbridge/scenarios/reviewed-app-bridge-launch.test.ts`
  - trace id(s):
    - `deef96de-e657-465f-b7f8-8aef3914cd9a` (`chatbridge.eval.chatbridge-reviewed-app-bridge-launch.cb-305-doc-proof-active`)
    - `bf430aef-39d3-4199-8526-9b456090778b` (`chatbridge.eval.chatbridge-reviewed-app-bridge-launch.cb-305-doc-proof-recovery`)
  - relevant code path(s):
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/packages/chatbridge/bridge/host-controller.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/packages/chatbridge/reviewed-app-launch.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/components/chatbridge/apps/ReviewedAppLaunchSurface.tsx`
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/packages/model-calls/stream-text.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/components/Artifact.tsx`
- Notes:
  - This audit gap is now closed for the reviewed-app launch seam without
    claiming later Pack 05 catalog or route-UI work is finished.
- Follow-up story candidate:
  - none; continue the queue at `CB-508`

### SA-006: Trace coverage is real but partial, and the web smoke surface produces no LangSmith runs

- Status: `fixed-during-audit`
- Severity: medium
- Area: observability
- Owning pack: Pack 00 and Pack 07
- Likely owning story: `CB-006`
- Environment: traced scenario suite plus live web smoke surface
- Repro steps:
  1. Run `LANGSMITH_TRACING=true LANGSMITH_PROJECT=chatbox-chatbridge pnpm exec vitest run test/integration/chatbridge/scenarios --reporter=verbose`.
  2. Inspect recent traces with `langsmith trace list --project chatbox-chatbridge --limit 50 --format json | jq -r '.[].name'`.
  3. Inspect `/private/tmp/chatbox-chessjs-devfix/src/renderer/adapters/langsmith.ts`.
- Expected: a broad ChatBridge smoke audit should yield traces across most flagship scenario families and the live UI path used for manual smoke.
- Actual:
  - the supported manual smoke path is now the desktop `/dev/chatbridge` Seed
    Lab path, and it emits named `chatbridge.manual_smoke.*` parent traces for
    supported active fixtures
  - the scenario trace matrix now leaves named evidence for catalog, routing,
    reviewed-app launch, recovery, persistence, and legacy auth/resource
    families under the shared `chatbox-chatbridge` project
  - the live web smoke surface remains intentionally non-traceable and is now
    documented as unsupported instead of silently appearing equivalent to the
    desktop path
- Evidence:
  - test or manual surface:
    - `src/renderer/components/dev/ChatBridgeSeedLab.tsx`
    - `src/renderer/dev/chatbridgeManualSmoke.ts`
    - `chatbridge/EVALS_AND_OBSERVABILITY.md`
    - traced targeted scenario runs for routing and Story Builder legacy auth/resource
  - trace id(s):
    - `bdb26275-763b-4d6f-a1e7-ffc952502e79` (`chatbridge.manual_smoke.chatbridge-chess-runtime.cb-006-doc-proof`)
    - `c08c1858-9964-4b66-9af3-58f79c739ef2` (`chatbridge.eval.chatbridge-routing-artifacts`)
    - `10ffa943-3bc4-43eb-88ec-7d0996d3dcff` (`chatbridge.eval.chatbridge-story-builder-auth-resource`)
    - `019d465f-b37c-7000-8000-03766cea7e83` (`chatbridge.eval.chatbridge-reviewed-app-registry`)
    - `019d4660-5956-7000-8000-006a6c7e96db` (`chatbridge.eval.chatbridge-single-app-discovery`)
    - `019d4660-723a-7000-8000-020a63a07686` (`chatbridge.eval.chatbridge-mid-game-board-context`)
    - `019d465f-8f90-7000-8000-0670371055f9` (`chatbridge.eval.chatbridge-persistence-and-shell-artifacts`)
    - `019d4660-05b0-7000-8000-047ebfe7755a` (`chatbridge.eval.chatbridge-bridge-handshake`)
  - relevant code path(s):
    - `/private/tmp/chatbox-chessjs-devfix/src/main/adapters/langsmith.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/shared/models/tracing.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/dev/chatbridgeManualSmoke.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/components/dev/ChatBridgeSeedLab.tsx`
- Notes:
  - CB-006 fixes the observability/manual-smoke gap without pretending the
    active catalog transition is already complete; Drawing Kit and Weather
    remain later stories.
  - CB-007 later hardened the same seams with runtime-target and smoke-support
    labels plus a scriptable seed/preset inspection helper, without reopening
    the now-supported desktop smoke path.
- Follow-up story candidate:
  - none; continue the queue at `CB-305`

### SA-007: ChatBridge sessions currently trigger renderer console issues during live smoke

- Status: `fixed-during-audit`
- Severity: low
- Area: UI quality and console hygiene
- Owning pack: cross-pack
- Likely owning story: `CB-105`
- Environment: web smoke pass against seeded ChatBridge sessions
- Repro steps:
  1. Open any seeded ChatBridge session in the live web surface.
  2. Inspect the generated console log under `.playwright-cli/console-*.log`.
- Expected: live smoke sessions should render without React prop warnings or accessibility warnings unrelated to the scenario under test.
- Actual:
  - `SystemAvatar` now strips `sessionType` before props reach the DOM-backed
    Mantine avatar surface
  - sidebar and thread-history drawer close flows now release focus before the
    hidden subtree transition happens
- Evidence:
  - test or manual surface:
    - `src/renderer/components/common/Avatar.test.tsx`
    - `src/renderer/components/common/overlay-focus.test.tsx`
    - `src/renderer/Sidebar.test.tsx`
    - `src/renderer/components/session/ThreadHistoryDrawer.test.tsx`
  - trace id(s):
    - none
  - relevant code path(s):
    - `src/renderer/components/common/Avatar.tsx`
    - `src/renderer/components/common/overlay-focus.ts`
    - `src/renderer/Sidebar.tsx`
    - `src/renderer/components/session/ThreadHistoryDrawer.tsx`
- Notes:
  - These warnings were low-severity compared with the runtime rebuild work, but
    closing them materially improves smoke-console signal and shell
    accessibility hygiene.
- Follow-up story candidate:
  - none; the active rebuild queue is complete unless new backfills are opened

### SA-008: Active flagship catalog transition is docs-only and runtime remains Chess-only

- Status: `fixed-during-audit`
- Severity: high
- Area: active reviewed-app catalog and live routing
- Owning pack: Pack 05
- Likely owning story: `CB-508`
- Environment: clean worktree `/private/tmp/chatbox-chessjs-devfix`, second-pass runtime probe after the 2026-04-02 catalog change
- Repro steps:
  1. Inspect `/private/tmp/chatbox-chessjs-devfix/src/shared/chatbridge/reviewed-app-catalog.ts`.
  2. Run a route probe with a valid host context for Drawing Kit, Weather, Story Builder, and Chess.
  3. Compare route and single-app results against the new active flagship plan.
- Expected: after the catalog transition, the active runtime should at least expose Chess, Drawing Kit, and Weather as the reviewed flagship set, even if the new apps are not fully implemented yet.
- Actual:
  - the default reviewed catalog now registers `['chess', 'drawing-kit',
    'weather-dashboard']`
  - explicit route decisions can now invoke Drawing Kit and Weather from the
    active catalog seam
  - Debate Arena and Story Builder are preserved through explicit
    legacy-reference helpers instead of the default runtime registry
  - Chess remains the only live executable reviewed-app tool on the main
    generation path, which stays correctly parked under SA-002 / `CB-506`
- Evidence:
  - test or manual surface:
    - `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && pnpm exec vitest run src/shared/chatbridge/reviewed-app-catalog.test.ts test/integration/chatbridge/scenarios/active-reviewed-catalog-transition.test.ts`
  - trace id(s):
    - `b54ae68a-7aa2-43a4-ad16-a7064f525bd7`
      (`chatbridge.eval.chatbridge-active-reviewed-catalog-transition-cb-508-doc-proof`)
  - relevant code path(s):
    - `/private/tmp/chatbox-chessjs-devfix/src/shared/chatbridge/reviewed-app-catalog.ts`
    - `/private/tmp/chatbox-chessjs-devfix/test/integration/chatbridge/scenarios/active-reviewed-catalog-transition.test.ts`
- Notes:
  - `CB-508` closes the catalog-transition gap without claiming the later live
    invocation/runtime work is complete. The remaining executable launch gap is
    already tracked separately by SA-002 / `CB-506`.
- Follow-up story candidate:
  - none; continue the queue at `CB-506`

### SA-009: Trace and scenario coverage still prove the legacy flagship set, not the active one

- Status: `fixed-during-audit`
- Severity: medium
- Area: traces, evals, and regression assets
- Owning pack: Pack 00 and Pack 05
- Likely owning story: `CB-508`
- Environment: traced second-pass scenario suite and LangSmith trace inspection
- Repro steps:
  1. Run `LANGSMITH_TRACING=true LANGSMITH_PROJECT=chatbox-chatbridge pnpm exec vitest run test/integration/chatbridge/scenarios --reporter=verbose`.
  2. Inspect recent traces with `langsmith trace list --project chatbox-chatbridge --limit 20 --format json`.
  3. Review the scenario names and trace names against the new active flagship plan.
- Expected: after the active catalog shift, the observable regression suite should either include Drawing Kit and Weather coverage or explicitly mark their absence as a known gap in the active audit.
- Actual:
  - the regression assets now include a traced active-catalog transition proof
    through `active-reviewed-catalog-transition.test.ts`
  - the checked-in eval docs and scenario README now explicitly distinguish
    active-catalog proof from legacy-reference Story Builder traces
  - Drawing Kit and Weather runtime/manual-smoke proof still remains queued for
    `CB-509` and `CB-510`, but that gap is now called out explicitly instead of
    being masked by legacy-only evidence
- Evidence:
  - test or manual surface:
    - `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && LANGSMITH_TRACING=true LANGSMITH_PROJECT=chatbox-chatbridge pnpm exec vitest run test/integration/chatbridge/scenarios/active-reviewed-catalog-transition.test.ts`
    - `test/integration/chatbridge/scenarios/README.md`
    - `chatbridge/EVALS_AND_OBSERVABILITY.md`
  - trace id(s):
    - `b54ae68a-7aa2-43a4-ad16-a7064f525bd7`
      (`chatbridge.eval.chatbridge-active-reviewed-catalog-transition-cb-508-doc-proof`)
  - relevant code path(s):
    - `/private/tmp/chatbox-chessjs-devfix/test/integration/chatbridge/scenarios/`
    - `/private/tmp/chatbox-chessjs-devfix/chatbridge/EVALS_AND_OBSERVABILITY.md`
    - `/private/tmp/chatbox-chessjs-devfix/test/integration/chatbridge/scenarios/README.md`
- Notes:
  - Legacy Story Builder auth/resource evidence remains intentionally present,
    but it is now described as legacy-reference coverage instead of active
    flagship proof.
  - Post-`CB-509` and `CB-510`, Drawing Kit and Weather now both have traced
    runtime/manual-smoke proof; the remaining active Pack 05 product gap is
    the live clarify/refuse UI tracked separately by SA-003 / `CB-507`.
- Follow-up story candidate:
  - none for the alignment layer; active-runtime/manual-smoke expansion is now
    closed and the queue moves to `CB-507`

### SA-010: Seeded manual smoke surfaces still center legacy Story Builder flows and old deep links are brittle

- Status: `fixed-during-audit`
- Severity: medium
- Area: manual smoke fixtures and live UI smoke
- Owning pack: Pack 05
- Likely owning story: `CB-508`
- Environment: seed fixture inspection and live browser smoke on `http://localhost:1212`
- Repro steps:
  1. Inspect `/private/tmp/chatbox-chessjs-devfix/src/shared/chatbridge/live-seeds.ts`.
  2. List the seed fixtures through `getChatBridgeLiveSeedFixtures()`.
  3. Open `http://localhost:1212/session/chatbox-chat-demo-chatbridge-history-and-preview` in the live web surface.
- Expected: the manual smoke corpus should be moving toward the active flagship set, or at minimum clearly identify legacy fixtures and preserve stable deep links for currently documented smoke paths.
- Actual:
  - the seed corpus now classifies fixtures as `active-flagship`,
    `platform-regression`, or `legacy-reference`
  - the active/platform fixtures now appear before the legacy
    `history-and-preview` reference in both live-seed and preset-session
    inspection order
  - the `history-and-preview` preset session id remains
    `chatbox-chat-demo-chatbridge-history-and-preview`, so the documented deep
    link stays stable even though the fixture is now explicit legacy scope
- Evidence:
  - test or manual surface:
    - `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && pnpm exec vitest run src/shared/chatbridge/live-seeds.test.ts src/renderer/packages/initial_data.test.ts src/renderer/setup/preset_sessions.test.ts src/renderer/components/dev/ChatBridgeSeedLab.test.tsx`
  - trace id(s):
    - `b54ae68a-7aa2-43a4-ad16-a7064f525bd7`
      (`chatbridge.eval.chatbridge-active-reviewed-catalog-transition-cb-508-doc-proof`)
  - relevant code path(s):
    - `/private/tmp/chatbox-chessjs-devfix/src/shared/chatbridge/live-seeds.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/packages/initial_data.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/components/dev/ChatBridgeSeedLab.tsx`
- Notes:
  - Post-`CB-509` and `CB-510`, the active seed corpus now includes the
    supported `drawing-kit-doodle-dare` and `weather-dashboard` flagship
    fixtures plus their matching preset sessions.
- Follow-up story candidate:
  - none for the labeling/deep-link layer; the remaining Pack 05 work is the
    clarify/refuse UI tracked by `CB-507`

### SA-011: Explicit Chess tool requests could still render the generic reviewed-launch shell and time out before showing a board

- Status: `fixed-during-audit`
- Severity: high
- Area: Chess reviewed-runtime handoff
- Owning pack: Pack 03
- Likely owning story: `CB-306`
- Environment: live prompt-driven Chess repro and focused runtime regression tests
- Repro steps:
  1. Ask for Chess analysis in plain chat, then explicitly correct the assistant with `No, I mean use the chess app tool`.
  2. Observe the reviewed launch card that says the host is launching Chess.
  3. Try to continue from the rendered surface.
- Expected: an explicit Chess-tool request should route to Chess, show the real Chess runtime board inline, and keep the board visible even if later bridge events fail.
- Actual:
  - the prompt could still spend time in plain chat before calling the Chess tool
  - successful Chess host-tool results normalized into the generic reviewed-launch shell instead of a real Chess runtime part
  - the generic shell could then degrade into `chess did not respond before the host timeout`, leaving the user without a visible board
- Evidence:
  - test or manual surface:
    - focused repro from the live chat surface using the explicit `use the chess app tool` correction
    - `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && pnpm exec vitest run src/shared/chatbridge/single-app-discovery.test.ts src/renderer/packages/chatbridge/reviewed-app-launch.test.ts test/integration/chatbridge/scenarios/chess-reviewed-runtime-handoff.test.tsx`
  - trace id(s):
    - traced scenario emitted under `chatbridge.eval.chatbridge-chess-reviewed-runtime-handoff`
  - relevant code path(s):
    - `/private/tmp/chatbox-chessjs-devfix/src/shared/chatbridge/single-app-discovery.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/packages/chatbridge/reviewed-app-launch.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/shared/chatbridge/apps/chess.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
- Notes:
  - `CB-306` intentionally fixes the Chess-specific runtime handoff without
    claiming the broader multi-app invoke path is solved. `CB-506` remains open
    for the active reviewed catalog beyond this urgent regression.
- Follow-up story candidate:
  - none; continue the queue at `CB-506`

## Approved Rebuild Story Queue

The smoke audit reopened ChatBridge for a focused rebuild sequence. These are
the canonical active backfill stories and their execution order after the
2026-04-02 flagship catalog change:

1. `CB-006` - traceable ChatBridge manual smoke harness and coverage expansion
2. `CB-007` - trace evidence quality and scriptable smoke inspection
3. `CB-305` - bridge host controller adoption for reviewed app launches
4. `CB-306` - deterministic Chess invocation and runtime handoff
5. `CB-508` - active reviewed catalog transition and legacy retention
6. `CB-506` - live reviewed app invocation path beyond Chess
7. `CB-509` - Drawing Kit flagship app
8. `CB-510` - Weather Dashboard flagship app
9. `CB-507` - live route clarify refuse artifacts and actions
10. `CB-105` - ChatBridge session console and accessibility hygiene

Legacy parked follow-up packets:

- `CB-505` - old flagship catalog parity packet for Debate Arena and Story Builder
- `CB-605` - Story Builder runtime auth and resource proxy integration

Use the checked-in story packets under `docs/specs/CHATBRIDGE-000-program-roadmap/`
for implementation. Do not fix these findings directly from this ledger without
updating the corresponding story packet.

## Working / Healthy Flows

Use this section to track flows that have been verified as healthy enough to
trust during the audit. Do not add a flow here unless there is current evidence
from either manual execution, a traced scenario run, or both.

- Chess seeded runtime accepts legal moves, rejects illegal moves, and updates
  the board/ledger inline.
  Evidence:
  - live UI verification in `http://localhost:1212/session/chatbox-chat-demo-chatbridge-chess-runtime`
  - illegal `E2 -> E5` rejection observed inline
  - legal `E2 -> E4` move persisted inline with updated ledger and FEN

- Story Builder seeded history and completion surfaces render coherently in the
  live UI.
  Evidence:
  - live UI verification in `http://localhost:1212/session/chatbox-chat-demo-chatbridge-history-and-preview`
  - completion card, Drive state, checkpoint list, and active draft card all render clearly

- Host-owned HTML preview opens inline and refreshes inside the chat shell.
  Evidence:
  - live UI verification in `http://localhost:1212/session/chatbox-chat-demo-chatbridge-history-and-preview`
  - preview button changed shell state from ready to running and rendered the embedded iframe inline

- Degraded completion recovery UI actions update the same message in place.
  Evidence:
  - live UI verification in `http://localhost:1212/session/chatbox-chat-demo-chatbridge-degraded-completion-recovery`
  - `Continue safely` updated the message state inline and disabled the selected action

- Weather Dashboard launches inline, refreshes through the host-owned weather
  boundary, and preserves a follow-up summary for later chat turns.
  Evidence:
  - `test/integration/chatbridge/scenarios/weather-dashboard-flagship.test.ts`
  - trace ids:
    - `8643edea-e549-4438-82ac-3e5db49d0314`
    - `51c19c3d-e03d-4ca0-b4a3-6dad545b2823`
    - `565aeb0a-522f-48df-ad93-b4a6737e3cdf`

- Core contract-level ChatBridge scenario suite is green under tracing.
  Evidence:
  - `LANGSMITH_TRACING=true LANGSMITH_PROJECT=chatbox-chatbridge pnpm exec vitest run test/integration/chatbridge/scenarios --reporter=verbose`
  - result: `22` files passed, `46` tests passed

## Audit Runs

### 2026-04-02 initial audit kickoff

- Branch: `codex/chatbridge-smoke-audit`
- Worktree: `/private/tmp/chatbox-chessjs-devfix`
- Objective: run traced ChatBridge smoke verification, inspect traces, and
  create the rebuild backlog from real observed failures
- Notes:
  - Preflight completed
  - Master ledger created
  - Traced scenario run completed:
    - `LANGSMITH_TRACING=true LANGSMITH_PROJECT=chatbox-chatbridge pnpm exec vitest run test/integration/chatbridge/scenarios --reporter=verbose`
    - outcome: `22` files passed, `46` tests passed
  - Live web smoke pass completed on:
    - `/dev/chatbridge`
    - seeded Chess runtime session
    - seeded History + preview session
    - seeded Degraded completion recovery session

### 2026-04-02 second audit pass after active catalog change

- Branch: `codex/chatbridge-smoke-audit-pass2`
- Worktree: `/private/tmp/chatbox-chessjs-devfix`
- Objective: verify whether the new active flagship direction is represented in
  runtime, traces, and manual smoke after `CB-508`, `CB-509`, and `CB-510`
  were added as planning packets
- Notes:
  - Traced scenario run completed again:
    - `LANGSMITH_TRACING=true LANGSMITH_PROJECT=chatbox-chatbridge pnpm exec vitest run test/integration/chatbridge/scenarios --reporter=verbose`
    - outcome: `22` files passed, `46` tests passed
  - Runtime route probe completed with a valid host context:
    - catalog still only exposed `chess`
    - Drawing Kit and Weather refused as `no-confident-match`
    - Chess still invoked through the legacy single-app launch path
  - Seed fixture inspection completed:
    - manual smoke corpus still includes legacy Story Builder fixtures
    - no Drawing Kit or Weather fixture exists yet
  - Live web smoke completed on:
    - `/dev/chatbridge`
    - `session/chatbox-chat-demo-chatbridge-history-and-preview`
  - Live UI outcome:
    - old `history-and-preview` deep link redirected to `/guide`
    - sidebar snapshot exposed only one visible ChatBridge seed entry

### 2026-04-02 evidence-quality validation after CB-007

- Branch: `codex/cb-007-trace-evidence-quality`
- Worktree: `/private/tmp/chatbox-chessjs-devfix`
- Objective: harden trace metadata/tag quality, normalize the manual smoke
  trace handoff, and add a scriptable seed/preset inspection seam
- Notes:
  - Focused red/green coverage completed for:
    - `test/integration/chatbridge/scenarios/scenario-tracing.test.ts`
    - `src/renderer/dev/chatbridgeManualSmoke.test.ts`
    - `src/renderer/components/dev/ChatBridgeSeedLab.test.tsx`
    - `src/shared/chatbridge/live-seeds.test.ts`
    - `src/renderer/packages/initial_data.test.ts`
  - Representative proof traces:
    - `chatbridge.manual_smoke.chatbridge-chess-runtime.cb-007-doc-proof`
      -> `55c99c6f-9854-4a11-babd-5ef0f2cb3b18`
    - `chatbridge.eval.chatbridge-routing-artifacts.cb-007-doc-proof`
      -> `92297c7b-8721-4927-a0b6-956d4ef835a7`
  - Scriptable inspection probe now returns schema version `1` plus the stable
    live-seed fixture ids and preset session ids from
    `getChatBridgeSmokeInspectionSnapshot()`
