# ChatBridge Integration Harness and Provider Fixtures

This document defines the Pack 0 integration-harness baseline for ChatBridge.
Its purpose is to make later platform stories testable before every real
external dependency exists.

## Foundation Principle

ChatBridge should default to secretless, repeatable integration tests that use
real host-side contracts with controlled mocks for provider, app, and service
boundaries.

The goal is not to avoid real integrations forever. The goal is to prevent Pack
1-3 stories from stalling because the final registry, auth broker, or partner
runtime is not fully deployed yet, even though the host shell now has a real
Phase 0 deployment surface.

## Current Repo Harness Assets

### Existing integration test substrate

- `vitest.config.ts`
  loads env for integration tests
- `test/integration/model-provider/model-provider.test.ts`
  proves provider integration can be opt-in and env-gated
- `test/integration/file-conversation/test-harness.ts`
  shows a reusable local harness pattern
- `test/integration/file-conversation/setup.ts`
  shows host-side mocking for settings, router, MCP, and platform
- `test/integration/mocks/model-dependencies.ts`
  provides a model/request/storage dependency seam
- `test/integration/mocks/sentry.ts`
  provides a simple observability stub

### Existing provider seam

- `src/shared/providers/registry.ts`
  is the current registry-style entry point for provider definitions

## Harness Strategy For ChatBridge

### What should be mocked by default in early packs

- reviewed app registry responses
- policy eligibility results
- partner app runtime messages
- partner auth-handle responses
- app instance persistence reads/writes
- audit / health sinks

### What should stay close to real host logic

- host lifecycle state handling
- bridge envelope validation
- tool invocation contract handling
- completion normalization
- context injection into later turns

### What may require opt-in real integrations later

- live model-provider calls
- live OAuth handshakes
- live remote storage or partner backends

## Proposed Starter Structure

The canonical starter location is:

- `test/integration/chatbridge`

Recommended substructure:

- `fixtures/`
  - app manifests
  - app lifecycle payloads
  - completion payloads
  - error payloads
- `mocks/`
  - mock registry adapter
  - mock policy adapter
  - mock auth broker
  - mock app runtime
- `scenarios/`
  - happy path
  - malformed payload
  - timeout/crash/degraded path
  - follow-up continuity path

## Real Versus Mock Policy

Use mocks when:

- the story is validating host-owned contracts
- the external system is not yet stable
- the test would otherwise require long-lived secrets or live accounts

Use real integrations when:

- the point of the story is provider/API compatibility
- auth or resource access is itself the behavior under test
- the mock would hide a contract risk we specifically need to catch

## Required Fixture Types

### App fixtures

- reviewed manifest fixture
- bridge init envelope fixture
- state-update fixture
- completion fixture
- recoverable error fixture

### Host fixtures

- session context fixture
- active app instance fixture
- routing decision fixture
- normalized summary fixture

### Provider fixtures

- tool-available provider fixture
- provider failure fixture
- slow/timeout fixture

## Failure Paths To Model Early

- malformed bridge messages
- stale or duplicate completion events
- policy denial before app launch
- host-side tool validation failure
- partner runtime crash after initial render
- auth request denied or expired

## Security Rules

- no real secrets by default
- no live partner credentials in checked-in fixtures
- no raw student content in reusable fixtures
- use deterministic fixture payloads wherever possible

## Dependency Map

- Pack 01 can reuse the harness for app-aware message-part and container-shell
  testing.
- Pack 02 can reuse the harness for manifest, bridge, and tool-contract tests.
- Pack 03 can reuse the harness for Chess lifecycle tests before a full partner
  runtime exists.
- Pack 06 can extend the same harness for auth-broker and resource-proxy flows.
