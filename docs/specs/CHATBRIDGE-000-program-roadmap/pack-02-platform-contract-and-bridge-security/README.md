# Pack 02 - Platform Contract and Bridge Security

## Phase Fit

- Phase: 2 of 7
- Primary objectives: O2, O3
- Unlocks: reviewed app manifests, durable app-instance records, launch-scoped bridge sessions, and host-led tool execution

## Pack Goal

Define what an approved app is, how it launches, how it talks to the host, and how the host validates execution and lifecycle events safely.

## Entry Gates

- Pack 01 storage and message seams are accepted.
- The team agrees that the host owns lifecycle and trust boundaries, not partner runtimes.

## Stories

- [CB-201 - Reviewed app manifest and registry contract](./cb-201-reviewed-app-manifest-and-registry-contract/feature-spec.md)
- [CB-202 - App instance and event domain model](./cb-202-app-instance-and-event-domain-model/feature-spec.md)
- [CB-203 - Launch-scoped bridge handshake and replay protection](./cb-203-launch-scoped-bridge-handshake-and-replay-protection/feature-spec.md)
- [CB-204 - Host-coordinated tool execution contract](./cb-204-host-coordinated-tool-execution-contract/feature-spec.md)

## Exit Criteria

- Reviewed app manifests are explicit and validated.
- App instances and events are modeled as first-class host records.
- Bridge traffic and tool execution semantics are launch-scoped, versioned, and replay-aware.

## Risks

- Shipping partner UI before the bridge contract is trustworthy.
- Treating origin checks alone as sufficient bridge security.
- Letting execution authority remain implicit between model, host, and app.
