# CB-506 Technical Plan

## Metadata

- Story ID: CB-506
- Story Title: Live reviewed app invocation path beyond Chess
- Author: Codex
- Date: 2026-04-02

## Proposed Design

- Components/modules affected:
  - `src/renderer/packages/model-calls/stream-text.ts`
  - `src/renderer/packages/chatbridge/single-app-tools.ts`
  - `src/renderer/packages/chatbridge/router/decision.ts`
  - `src/renderer/packages/chatbridge/router/`
  - `src/renderer/components/chatbridge/`
- Public interfaces/contracts:
  - reviewed route decision -> live invocation contract
  - invoke outcome -> host-owned launch, refusal, or error handling contract
  - trace/log distinction between route decision and launch execution
- Data flow summary:
  prompt arrives -> host evaluates reviewed candidates -> route decision
  selects invoke or non-invoke outcome -> invoke path launches the reviewed app
  through host-owned runtime control instead of the Chess-only shortcut.

## Architecture Decisions

- Decision:
  remove the single-app shortcut as the only executable reviewed-app path and
  make live invocation consume the reviewed routing contract.
- Alternatives considered:
  - bolt more apps onto the current Chess-only tool shortcut
  - keep live runtime Chess-only and treat other apps as seeded/demo-only
- Rationale:
  Pack 05 claims a reviewed multi-app runtime. The live generation path must
  consume that contract rather than continuing to bypass it.

## Data Model / API Contracts

- Request shape:
  route decisions and single-app fallback heuristics should be validated and
  normalized before invocation.
- Response shape:
  invoke outcomes should update host-owned launch and recovery state with clear
  result metadata.
- Storage/index changes:
  none by default; this is runtime orchestration wiring.

## Dependency Plan

- Existing dependencies used:
  reviewed catalog, eligibility filters, route decision helpers, bridge launch
  surfaces, and Pack 04 completion/summary seams
- New dependencies proposed (if any):
  none
- Risk and mitigation:
  keep route selection and visible clarify/refuse UI separated so invoke-path
  repair does not mix concerns with CB-507

## Test Strategy

- Unit tests:
  - reviewed invocation path selection
  - natural Chess prompt coverage for opening-analysis, raw FEN, PGN, and
    "best move" prompts
  - explicit invocation failure handling
- Integration tests:
  prove fresh runtime can launch a non-Chess reviewed app from the live prompt
  path
- E2E or smoke tests:
  rerun manual fresh-thread prompts for Chess natural-language requests plus
  the new non-Chess flagship launch attempts
- Edge-case coverage mapping:
  missing route decisions, duplicate launches, and launch errors should be
  covered explicitly

## UI Implementation Plan

- Behavior logic modules:
  keep invocation logic in model-call and chatbridge runtime packages, not
  presentation-only surfaces
- Component structure:
  continue using current ChatBridge shell components for launched runtime state
- Accessibility implementation plan:
  preserve existing launch progress and failure semantics in the shell
- Visual regression capture plan:
  not required unless bridge launch states change materially

## Rollout and Risk Mitigation

- Rollback strategy:
  isolate the live invocation rewrite from catalog parity and route-UI work
- Feature flags/toggles:
  a narrow host-side toggle is acceptable if smoke proof needs staged rollout
- Observability checks:
  trace the invoke path distinctly from clarify/refuse and chat-only fallbacks,
  including when the resolved app remains Chess

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
