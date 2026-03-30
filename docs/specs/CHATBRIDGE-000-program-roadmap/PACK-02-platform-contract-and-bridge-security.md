# Pack 02 - Platform Contract and Bridge Security

> Summary mirror only. Use the canonical folder:
> `pack-02-platform-contract-and-bridge-security/`

## Phase Fit

- Phase: 2 of 7
- Primary objectives: O2, O3
- Unlocks: reviewed app registry, launch-scoped bridge sessions, host-led tool
  execution, durable app instance records

## Pack Goal

Define the actual platform contract before any serious partner surface ships:
what an app is, how it is approved, how it launches, how it talks to the host,
and how the host coordinates tool execution safely.

## Entry Gates

- Pack 01 host and persistence seams are defined.
- The team agrees that app lifecycle and security are host concerns, not partner
  concerns.

## Stories

### CB-201 Reviewed app manifest and registry contract

- Goal:
  define the validated manifest shape and reviewed registration lifecycle.
- Acceptance focus:
  reviewed metadata, tool schemas, auth mode, permissions, supported events,
  completion modes, timeouts, and safety metadata are explicit.
- Likely surfaces:
  new `src/shared/chatbridge/manifest.ts`,
  registry request/storage client modules,
  validation tests.

### CB-202 App instance and event domain model

- Goal:
  create typed host records for `appInstance`, `appEvent`, and runtime status.
- Acceptance focus:
  host lifecycle state becomes durable and queryable instead of being hidden in
  transient UI state.
- Likely surfaces:
  new `src/shared/chatbridge/instance.ts`,
  `src/renderer/packages/chatbridge/`,
  storage/service adapters.

### CB-203 Launch-scoped bridge handshake and replay protection

- Goal:
  establish `bridgeSession`, signed init envelope, dedicated channel, sequence
  validation, and idempotency rules.
- Acceptance focus:
  the host rejects spoofed, stale, duplicated, or malformed app events.
- Likely surfaces:
  new `src/main/chatbridge/`,
  `src/preload/`,
  `src/renderer/packages/chatbridge/bridge/`,
  current MCP/IPC transport patterns as exemplars.

### CB-204 Host-coordinated tool execution contract

- Goal:
  define how app tools are validated, versioned, executed, retried, and logged.
- Acceptance focus:
  the host remains the authoritative execution coordinator even when the app
  owns UI state.
- Likely surfaces:
  `src/renderer/packages/model-calls/stream-text.ts`,
  `src/shared/models/abstract-ai-sdk.ts`,
  new `src/shared/chatbridge/tools.ts`.

## Exit Criteria

- A reviewed manifest contract exists.
- App instances and events are modeled explicitly.
- Bridge security is launch-scoped and replay-aware on paper before partner work
  begins.
- Tool execution rules are no longer implied by general-purpose tool calling.

## Risks

- Treating plain `postMessage` plus origin checks as sufficient
- Letting the model or partner app implicitly define execution authority
- Deferring schema versioning and idempotency until after apps exist
