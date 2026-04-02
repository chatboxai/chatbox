# ChatBridge Partner SDK and Local Harness

This guide is the Pack 07 reviewed-partner development surface for ChatBridge.
It is intentionally narrow: build against the current host-owned contract,
validate early, and debug through the local harness before requesting platform
review.

## What This Covers

- reviewed manifest validation against the current host support matrix
- launch-scoped bridge expectations for embedded partner runtimes
- host-managed auth expectations for reviewed apps
- explicit completion signaling and host-owned summary rules
- a local mock harness for partner-runtime conformance tests

Authoritative repo surfaces:

- `src/shared/chatbridge/partner-validator.ts`
- `test/integration/chatbridge/mocks/partner-harness.ts`
- `test/integration/chatbridge/scenarios/partner-sdk-harness.test.ts`

## Validator Entry Point

Use `validateChatBridgePartnerManifest` to fail fast before a manifest enters
review:

```ts
import { validateChatBridgePartnerManifest } from '@shared/chatbridge'

const report = validateChatBridgePartnerManifest(candidateEntry)

if (!report.valid) {
  console.error(report.issues)
}
```

The report gives you:

- `valid`: whether the manifest matches the current reviewed-host contract
- `issues`: structured errors and warnings
- `support`: current protocol, auth-mode, event, and completion support
- `guidance`: required manifest events, auth boundary, completion schema, and
  debugging checklist

Validation is fail-closed. Unsupported protocol versions, unsupported auth
modes, malformed schemas, or missing mandatory lifecycle events are errors.

## Required Reviewed-App Contract

Your manifest must stay aligned with the current reviewed-app contract in
`src/shared/chatbridge/manifest.ts`.

Required lifecycle expectations:

- declare `host.init`
- declare `app.ready`
- declare `app.complete`
- for `oauth` or `api-key` apps, also declare `app.requestAuth`

Strongly recommended:

- declare `app.state` so the host can preserve resumable snapshots
- declare `app.error` so degraded recovery is explicit instead of inferred

The host currently supports:

- protocol version `1`
- auth modes `none`, `host-session`, `oauth`, `api-key`
- bridge lifecycle events from the reviewed manifest support matrix
- completion modes `message`, `summary`, `state`, `handoff`

## Launch-Scoped Bridge Rules

The local harness exercises the same launch-scoped bridge controller the host
uses for approved runtimes.

Rules that partner runtimes must respect:

- accept the `host.bootstrap` envelope only from the expected origin
- treat `bridgeSessionId`, `bridgeToken`, and `bootstrapNonce` as launch-scoped
  secrets
- acknowledge with `app.ready` before sending `app.state`, `app.complete`, or
  `app.error`
- send strictly increasing `sequence` values
- send unique `idempotencyKey` values for `app.state`, `app.complete`, and
  `app.error`

The current bridge-runtime event surface is:

- `app.ready`
- `app.state`
- `app.complete`
- `app.error`

Replay, stale sequence numbers, duplicate idempotency keys, malformed payloads,
and expired bridge sessions are rejected explicitly.

## Auth Expectations

Reviewed partner apps do not own raw long-lived credentials.

Auth rules by mode:

- `none`: no platform or app grant required
- `host-session`: Chatbox platform session required, but no app grant
- `oauth` / `api-key`: platform session plus host-managed app grant required

For `oauth` and `api-key` apps:

- the host is the credential owner
- the runtime should request access through host-managed auth flows
- the runtime should use scoped credential handles or host-mediated resource
  access
- raw Drive, OAuth, or API tokens should never live inside the partner runtime

Relevant contract surfaces:

- `src/shared/chatbridge/auth.ts`
- `src/shared/chatbridge/resource-proxy.ts`

## Completion and Memory Expectations

Completion is mandatory and explicit.

Use `app.complete` with the structured payload contract in
`src/shared/chatbridge/completion.ts`.

Key rules:

- emit `schemaVersion: 1`
- use a supported completion mode from the manifest
- keep outcome data structured
- a partner may provide `suggestedSummary`
- only the host may write `summaryForModel`

That last rule is critical: partner runtimes do not write directly into model
memory. They provide structured output; the host validates, normalizes, and
decides what later chat turns may see.

## Local Harness

The local/mock host harness lives in:

- `test/integration/chatbridge/mocks/partner-harness.ts`

It wraps the real host controller so partners can verify:

- bootstrap envelope handling
- `app.ready` acknowledgement
- `host.render` delivery
- accepted versus rejected runtime events
- observability signals
- recovery decisions for malformed or replayed traffic

Representative usage lives in:

- `test/integration/chatbridge/scenarios/partner-sdk-harness.test.ts`

Keep new partner fixtures deterministic and secretless. The local harness is
for contract compatibility and failure debugging, not for bypassing reviewed
host controls.
