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

- Status: `confirmed`
- Severity: high
- Area: live chat orchestration
- Owning pack: Pack 03 and Pack 05
- Likely owning story: `CB-506`
- Environment: clean worktree `/private/tmp/chatbox-chessjs-devfix`, default renderer generation path
- Repro steps:
  1. Inspect `/private/tmp/chatbox-chessjs-devfix/src/renderer/packages/model-calls/stream-text.ts`.
  2. Follow the tool construction path into `/private/tmp/chatbox-chessjs-devfix/src/renderer/packages/chatbridge/single-app-tools.ts`.
  3. Confirm that only `CHATBRIDGE_CHESS_TOOL_NAME` ever becomes an executable tool.
- Expected: after Pack 05, reviewed app launch should be mediated through a real multi-app route/clarify/refuse path rather than a Chess-only shortcut.
- Actual: the live `streamText(...)` path only mounts `createReviewedSingleAppToolSet(...)`, and that tool set only returns an executable tool for Chess.
- Evidence:
  - test or manual surface:
    - code inspection of:
      - `/private/tmp/chatbox-chessjs-devfix/src/renderer/packages/model-calls/stream-text.ts`
      - `/private/tmp/chatbox-chessjs-devfix/src/renderer/packages/chatbridge/single-app-tools.ts`
  - trace id(s):
    - `019d4660-5956-7000-8000-006a6c7e96db` (`chatbridge.eval.chatbridge-single-app-discovery`)
  - relevant code path(s):
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/packages/model-calls/stream-text.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/packages/chatbridge/single-app-tools.ts`
- Notes:
  - Even if routing logic exists elsewhere, the main user-facing generation path is not consuming it.
- Follow-up story candidate:
  - `CB-506` - Live reviewed app invocation path beyond Chess

### SA-003: Route decisions and clarify/refuse artifacts are effectively test-only seams

- Status: `confirmed`
- Severity: high
- Area: route UX
- Owning pack: Pack 05
- Likely owning story: `CB-507`
- Environment: clean worktree `/private/tmp/chatbox-chessjs-devfix`
- Repro steps:
  1. Search for runtime use of `getReviewedAppRouteDecision(...)` and `createReviewedAppRouteArtifact(...)`.
  2. Search for renderer use of `chatbridgeRouteDecision`.
  3. Confirm that the route artifact contract is exercised in tests but not rendered through a decision-specific live UI.
- Expected: ambiguous and chat-only cases should surface a live clarify/refuse artifact with actionable next steps in the chat UI.
- Actual: route decision creation is exercised in tests, but renderer code does not have a dedicated route-decision surface. `chatbridgeRouteDecision` is only parsed in shared code and never rendered as a decision-specific UI with choices.
- Evidence:
  - test or manual surface:
    - `rg -n "createReviewedAppRouteArtifact|getReviewedAppRouteDecision|chatbridgeRouteDecision" src test`
    - result shows runtime use concentrated in tests, not the live message-rendering path
  - trace id(s):
    - none specific to a live route artifact
  - relevant code path(s):
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/packages/chatbridge/router/decision.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/shared/chatbridge/routing.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/components/chatbridge/apps/surface.tsx`
- Notes:
  - This is a core reason Pack 05 can look complete in tests while still feeling missing in a fresh user flow.
- Follow-up story candidate:
  - `CB-507` - Live route clarify refuse artifacts and actions

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

- Status: `confirmed`
- Severity: high
- Area: bridge runtime
- Owning pack: Pack 02 and Pack 03
- Likely owning story: `CB-305`
- Environment: clean worktree `/private/tmp/chatbox-chessjs-devfix`
- Repro steps:
  1. Search for `createBridgeHostController(...)` in runtime code.
  2. Compare actual usages against expected reviewed-app launch surfaces.
- Expected: the reviewed embedded-app bridge should be the live runtime seam for app launches and state updates.
- Actual: the bridge host controller is used in tests, the partner harness, and `/private/tmp/chatbox-chessjs-devfix/src/renderer/components/Artifact.tsx` for HTML preview. It is not the actual launch/runtime path for Story Builder or Debate Arena.
- Evidence:
  - test or manual surface:
    - `rg -n "createBridgeHostController\\(" src test`
  - trace id(s):
    - `019d4660-05b0-7000-8000-047ebfe7755a` (`chatbridge.eval.chatbridge-bridge-handshake`)
  - relevant code path(s):
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/packages/chatbridge/bridge/host-controller.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/components/Artifact.tsx`
- Notes:
  - This explains why bridge-session tests can pass while live flagship app launches still behave like seeded cards instead of true embedded runtimes.
- Follow-up story candidate:
  - `CB-305` - Bridge host controller adoption for reviewed app launches

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
- Follow-up story candidate:
  - none; continue the queue at `CB-305`

### SA-007: ChatBridge sessions currently trigger renderer console issues during live smoke

- Status: `confirmed`
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
  - React warning for unknown DOM prop `sessionType`
  - accessibility warning about `aria-hidden` while focus remains inside the subtree
- Evidence:
  - test or manual surface:
    - `/private/tmp/chatbox-chessjs-devfix/.playwright-cli/console-2026-04-02T19-19-22-730Z.log`
  - trace id(s):
    - none
  - relevant code path(s):
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/components/common/Avatar.tsx`
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/components/chat/Message.tsx`
- Notes:
  - These are not the biggest ChatBridge functional blockers, but they pollute manual QA and make real runtime issues harder to isolate.
- Follow-up story candidate:
  - `CB-105` - ChatBridge session console and accessibility hygiene

### SA-008: Active flagship catalog transition is docs-only and runtime remains Chess-only

- Status: `confirmed`
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
  - the default reviewed catalog is still `['chess']`
  - Drawing Kit and Weather both refuse with `no-confident-match`
  - Story Builder also refuses, which is now acceptable as a legacy app
  - Chess still invokes successfully through the old live single-app path
- Evidence:
  - test or manual surface:
    - `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && pnpm exec tsx <<'TS' ... ensureDefaultReviewedAppsRegistered() ... getReviewedAppRouteDecision(...) ... createReviewedSingleAppToolSet(...) ... TS`
    - output showed:
      - `catalog [ 'chess' ]`
      - Drawing Kit: `kind: "refuse"`, `reasonCode: "no-confident-match"`
      - Weather: `kind: "refuse"`, `reasonCode: "no-confident-match"`
      - Chess: `kind: "invoke"` plus `toolNames: ["chess_prepare_session"]`
  - trace id(s):
    - none for the direct runtime probe
  - relevant code path(s):
    - `/private/tmp/chatbox-chessjs-devfix/src/shared/chatbridge/reviewed-app-catalog.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/packages/chatbridge/router/decision.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/packages/chatbridge/single-app-tools.ts`
- Notes:
  - The active product direction is now ahead of runtime truth. Right now the repo says Chess, Drawing Kit, and Weather are the active flagship set, but the runtime still only knows Chess.
- Follow-up story candidate:
  - `CB-508` - Active reviewed catalog transition and legacy retention

### SA-009: Trace and scenario coverage still prove the legacy flagship set, not the active one

- Status: `confirmed`
- Severity: medium
- Area: traces, evals, and regression assets
- Owning pack: Pack 00 and Pack 05
- Likely owning story: `CB-006`
- Environment: traced second-pass scenario suite and LangSmith trace inspection
- Repro steps:
  1. Run `LANGSMITH_TRACING=true LANGSMITH_PROJECT=chatbox-chatbridge pnpm exec vitest run test/integration/chatbridge/scenarios --reporter=verbose`.
  2. Inspect recent traces with `langsmith trace list --project chatbox-chatbridge --limit 20 --format json`.
  3. Review the scenario names and trace names against the new active flagship plan.
- Expected: after the active catalog shift, the observable regression suite should either include Drawing Kit and Weather coverage or explicitly mark their absence as a known gap in the active audit.
- Actual:
  - the traced suite is still green on the old flagship set
  - named scenario coverage still includes `debate-arena-lifecycle` and `story-builder-lifecycle`
  - there are still no Drawing Kit or Weather scenarios or trace families
  - recent LangSmith names are unchanged from the earlier audit and remain centered on the old runtime seams
- Evidence:
  - test or manual surface:
    - traced run: `22` files passed, `46` tests passed
    - scenario names still include:
      - `test/integration/chatbridge/scenarios/debate-arena-lifecycle.test.ts`
      - `test/integration/chatbridge/scenarios/story-builder-lifecycle.test.ts`
      - `test/integration/chatbridge/scenarios/full-program-convergence.test.ts`
  - trace id(s):
    - `7020574d-8d43-46d6-8c41-b89522667be7` (`chatbox.trace.smoke`)
    - recent trace names remained:
      - `chatbridge.eval.chatbridge-mid-game-board-context`
      - `chatbridge.eval.chatbridge-single-app-discovery`
      - `chatbridge.eval.chatbridge-host-tool-contract`
      - `chatbridge.eval.chatbridge-bridge-handshake`
      - `chatbridge.eval.chatbridge-app-instance-domain-model`
      - `chatbridge.eval.chatbridge-reviewed-app-registry`
      - `chatbridge.eval.chatbridge-persistence-and-shell-artifacts`
  - relevant code path(s):
    - `/private/tmp/chatbox-chessjs-devfix/test/integration/chatbridge/scenarios/`
    - `/private/tmp/chatbox-chessjs-devfix/src/shared/models/tracing.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/adapters/langsmith.ts`
- Notes:
  - This is now a mismatch between the active roadmap and the regression assets. The suite is useful, but it still proves the old world.
- Follow-up story candidate:
  - `CB-006` - Traceable ChatBridge manual smoke harness and coverage expansion

### SA-010: Seeded manual smoke surfaces still center legacy Story Builder flows and old deep links are brittle

- Status: `confirmed`
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
  - fixture names still include `History + preview`, whose description explicitly says it seeds a real Story Builder session
  - there are no Drawing Kit or Weather fixtures
  - the old `history-and-preview` deep link redirected to `/guide` in the live web smoke pass
  - the resulting sidebar snapshot showed only one visible ChatBridge seed entry
- Evidence:
  - test or manual surface:
    - `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && pnpm exec tsx <<'TS' ... getChatBridgeLiveSeedFixtures() ... TS`
    - output included:
      - `[Seeded] ChatBridge: History + preview :: Seeds a real Story Builder session ...`
    - Playwright live smoke:
      - `http://localhost:1212/session/chatbox-chat-demo-chatbridge-history-and-preview`
      - snapshot file: `.playwright-cli/page-2026-04-02T19-51-46-532Z.yml`
      - console file: `.playwright-cli/console-2026-04-02T19-51-44-888Z.log`
  - trace id(s):
    - none
  - relevant code path(s):
    - `/private/tmp/chatbox-chessjs-devfix/src/shared/chatbridge/live-seeds.ts`
    - `/private/tmp/chatbox-chessjs-devfix/src/renderer/packages/initial_data.ts`
- Notes:
  - This makes the manual smoke workflow drift-prone right when it should be helping validate the new flagship transition.
- Follow-up story candidate:
  - `CB-508` - Active reviewed catalog transition and legacy retention

## Approved Rebuild Story Queue

The smoke audit reopened ChatBridge for a focused rebuild sequence. These are
the canonical active backfill stories and their execution order after the
2026-04-02 flagship catalog change:

1. `CB-006` - traceable ChatBridge manual smoke harness and coverage expansion
2. `CB-007` - trace evidence quality and scriptable smoke inspection
3. `CB-305` - bridge host controller adoption for reviewed app launches
4. `CB-508` - active reviewed catalog transition and legacy retention
5. `CB-506` - live reviewed app invocation path beyond Chess
6. `CB-509` - Drawing Kit flagship app
7. `CB-510` - Weather Dashboard flagship app
8. `CB-507` - live route clarify refuse artifacts and actions
9. `CB-105` - ChatBridge session console and accessibility hygiene

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
