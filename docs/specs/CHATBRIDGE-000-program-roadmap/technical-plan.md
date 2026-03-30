# ChatBridge Program Technical Plan

## Metadata

- Story ID: CHATBRIDGE-000
- Story Title: ChatBridge phased roadmap and story-pack plan
- Author: Codex
- Date: 2026-03-30

## Proposed Design

- Components/modules affected:
  this planning set is documentation-only, but it proposes future insertion
  seams at:
  `src/shared/chatbridge/`,
  `src/renderer/packages/chatbridge/`,
  `src/renderer/components/chatbridge/`,
  `src/main/chatbridge/`,
  `src/preload/`,
  `src/renderer/storage/`,
  `test/integration/chatbridge/`,
  and `src/__tests__/chatbridge/`.
- Public interfaces/contracts:
  reviewed app manifests, bridge envelopes, app instance records, app events,
  tool execution envelopes, policy decisions, auth grant handles, and
  `summaryForModel` normalization rules.
- Data flow summary:
  the host runtime resolves app eligibility, injects only approved tools into
  orchestration, opens an app container, validates app events, persists
  normalized outcomes, and feeds approved app state back into later model turns.

## Architecture Decisions

- Decision:
  structure implementation as a Pack 0 foundation plus ordered vertical packs
  that map to the required strategy: basic chat, app registration, single-app
  invocation, UI embedding, completion, context retention, multi-app routing,
  auth, error handling, and partner docs.
- Alternatives considered:
  build all three apps in parallel first; start with marketplace tooling; solve
  app UI embedding before completion and memory.
- Rationale:
  the presearch is explicit that lifecycle ownership, completion semantics, and
  trust boundaries are the real risks. The roadmap therefore front-loads those
  contracts before partner breadth.

## Data Model / API Contracts

- Request shape:
  future host/runtime contracts should distinguish user chat requests, reviewed
  app launches, bridge events, tool invocations, auth requests, and completion
  payloads.
- Response shape:
  the host should produce normalized app cards, validated state snapshots,
  recoverable runtime errors, and approved summaries for model context.
- Storage/index changes:
  planned first-class records are:
  `conversations`,
  `messages`,
  `app_registrations`,
  `app_versions`,
  `app_instances`,
  `app_events`,
  `tool_invocations`,
  `user_app_auth_grants`,
  `tenant_app_policies`,
  and `audit_events`.

## Dependency Plan

- Existing dependencies used:
  current Chatbox session schemas, tool-call rendering, streaming AI SDK
  adapters, MCP transport precedent, and authenticated request utilities.
- New dependencies proposed:
  none at the roadmap stage; any new runtime dependency should be justified
  story-by-story later.
- Risk and mitigation:
  the main risk is inventing modules that do not fit the existing app shape.
  This plan mitigates that by attaching each pack to concrete current code
  surfaces before implementation starts.

## Test Strategy

- Unit tests:
  new manifest validators, bridge envelope parsers, policy evaluators, summary
  normalizers, and routing decisions.
- Integration tests:
  host runtime plus mock app lifecycles, completion handoff, reconciliation, and
  auth-handle flows.
- E2E or smoke tests:
  full chat -> app -> completion -> later follow-up continuity for Chess,
  Debate Arena, and Story Builder.
- Edge-case coverage mapping:
  reconnects, replayed events, missing completion, invalid tool payloads,
  app crash, OAuth denial, expired grants, policy refusal, and tenant disable.

## Foundation Instrumentation

- Pack 0 should establish environment contracts, deployment/bootstrap shape,
  provider/app integration setup, and a baseline trace/eval/observability layer.
- The goal is to enable trace-driven development for orchestration-heavy work
  before the first serious ChatBridge lifecycle changes land.
- Later packs should extend that foundation rather than bolt observability on at
  the end.

## UI Implementation Plan

- Behavior logic modules:
  host runtime state, active app pointers, policy/refusal decisions, app event
  persistence, and summary normalization live outside the visual components.
- Component structure:
  pack work will eventually extend the timeline message rendering and add a
  dedicated `chatbridge` component surface for embedded app cards, auth prompts,
  completion cards, and router clarifiers.
- Accessibility implementation plan:
  each visible implementation story should define roles, focus behavior,
  keyboard escape/close flows, and readable status/error messaging.
- Visual regression capture plan:
  any visible app container, auth, completion, or router state must go through
  a normal story folder plus Pencil review before code.

## Rollout and Risk Mitigation

- Rollback strategy:
  keep phases vertically gated and avoid cross-pack UI or runtime assumptions
  before the previous pack exits green.
- Feature flags/toggles:
  recommended later for app registry enablement, specific partner apps, auth
  flows, tenant rollout, and safety kill switches.
- Observability checks:
  Pack 0 should establish baseline traces, eval fixtures, and lifecycle
  telemetry; later packs should deepen app launch/completion/error telemetry,
  policy refusals, auth grant state, and per-app health signals.

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
