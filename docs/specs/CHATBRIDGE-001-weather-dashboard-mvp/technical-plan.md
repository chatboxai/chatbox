# CHATBRIDGE-001 Technical Plan

## Metadata

- Story ID: CHATBRIDGE-001
- Story Title: Weather Dashboard MVP
- Author: Codex
- Date: 2026-04-02

## Proposed Design

- Components and modules expected when implementation starts:
  - `src/shared/chatbridge/apps/weather-dashboard/manifest.ts`
  - `src/shared/chatbridge/apps/weather-dashboard/contracts.ts`
  - `src/main/chatbridge/weather-provider/`
  - `src/renderer/components/chatbridge/apps/weather-dashboard/`
  - `src/renderer/packages/chatbridge/`
- Public interfaces and contracts:
  - weather intent and location resolution input shape
  - normalized weather snapshot contract
  - app session state and refresh action contract
  - completion summary contract for later model turns

## Architecture Decisions

- Use a host-fetched public weather provider rather than direct app-side API
  access.
  Rationale: keeps trust boundaries simple and matches the host-owned
  architecture.
- Normalize provider responses into one repo-owned forecast shape before UI
  rendering.
  Rationale: prevents the weather app from leaking provider-specific fields into
  later routing or memory logic.
- Treat weather as a utility app with resumable state and explicit close,
  not as a fire-and-forget tool response.
  Rationale: the goal is to prove an actual app lifecycle, not another text tool
  output.
- Require freshness metadata on every snapshot.
  Rationale: weather answers degrade quickly; stale state must be detectable by
  the host and the user.

## Data Flow Summary

1. User asks for weather in chat.
2. Host routes to the weather app path or asks for location clarification.
3. Host resolves the selected location and requests forecast data through a
   provider adapter.
4. Provider data is normalized into a repo-owned snapshot with freshness and
   alert metadata.
5. Host creates or updates the app session state and renders the dashboard in
   the thread.
6. User can refresh, change location, or ask follow-up chat questions against
   the active snapshot.
7. Host persists a normalized summary when the session closes or ages out.

## Data Model Sketch

- `WeatherQuery`
  - `locationText`
  - `resolvedLocationId`
  - `timezone`
  - `units`
- `WeatherSnapshot`
  - `current`
  - `hourly`
  - `daily`
  - `alerts`
  - `fetchedAt`
  - `staleAt`
- `WeatherDashboardState`
  - `appInstanceId`
  - `query`
  - `snapshot`
  - `status`
  - `lastRefreshRequestId`
- `WeatherSummaryForModel`
  - normalized natural-language summary
  - explicit freshness note
  - latest alert or degraded-state note

## Story-Level Breakdown

- `WD-101`: Weather intent routing and location clarification
- `WD-102`: Weather provider adapter and snapshot normalization
- `WD-103`: In-thread dashboard shell and rendering states
- `WD-104`: Refresh, change-location, and follow-up continuity
- `WD-105`: Degraded behavior, completion summary, and regression coverage

## Dependency Plan

- Existing dependencies used:
  current chat routing, host lifecycle, message rendering, and app-memory seams
- New dependency posture:
  keep the provider behind an adapter seam so the first implementation can use a
  minimal provider choice without coupling the rest of ChatBridge to it
- Major risks:
  - location ambiguity causes silent wrong answers
  - provider schema drift leaks into host memory
  - stale weather data appears authoritative after resume

## Test Strategy

- Unit tests:
  location parsing, snapshot normalization, freshness calculations,
  completion-summary generation
- Integration tests:
  chat request to weather app launch, refresh flow, follow-up answer using
  active weather state, degraded provider failure path
- Smoke tests:
  one happy-path city, one ambiguous city, one provider-failure case

## UI Implementation Plan

- Keep dashboard state in the host/session layer, not buried inside leaf UI
  components.
- Plan for three primary visual states:
  loading, fresh snapshot, degraded or stale snapshot.
- Use Pencil variations to choose layout before implementation because the app
  introduces a new embedded dashboard surface.

## Rollout and Risk Mitigation

- Ship behind a feature flag if ChatBridge app routing is already live.
- Fail closed to normal chat when location resolution or provider normalization
  cannot establish a safe app state.
- Log launch, refresh, failure, and close events with enough detail to debug
  stale or repeated requests.

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
