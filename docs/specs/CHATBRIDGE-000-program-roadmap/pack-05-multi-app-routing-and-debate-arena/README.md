# Pack 05 - Multi-App Routing and Debate Arena

Operational tracking: [`STATUS.md`](./STATUS.md)

## Current Rebuild Posture

- Phase: 5 of 7
- Primary objectives: O1, O3
- Historical baseline remains checked in through CB-501 to CB-504.
- Active rebuild target after the 2026-04-02 catalog change is Chess, Drawing
  Kit, and Weather.

## Reopened Goal

Keep the reviewed-app platform explainable and host-owned while transitioning
the active flagship set away from Debate Arena and Story Builder without losing
their reference value.

## Active Rebuild Queue

1. [CB-508 - Active reviewed catalog transition and legacy retention](./cb-508-active-reviewed-catalog-transition-and-legacy-retention/feature-spec.md)
2. [CB-506 - Live reviewed app invocation path beyond Chess](./cb-506-live-reviewed-app-invocation-path-beyond-chess/feature-spec.md)
3. [CB-509 - Drawing Kit flagship app](./cb-509-drawing-kit-flagship-app/feature-spec.md)
4. [CB-510 - Weather Dashboard flagship app](./cb-510-weather-dashboard-flagship-app/feature-spec.md)
5. [CB-507 - Live route clarify refuse artifacts and actions](./cb-507-live-route-clarify-refuse-artifacts-and-actions/feature-spec.md)

Legacy parked packets:

- [CB-505 - Default reviewed app catalog parity for flagship apps](./cb-505-default-reviewed-app-catalog-parity-for-flagship-apps/feature-spec.md)

Forward-looking extension packets:

- [CB-511 - Native stateful chat-app integration](./cb-511-native-stateful-chat-app-integration/feature-spec.md)

## Historical Baseline Stories

- [CB-501 - Reviewed app discovery and eligibility filtering](./cb-501-reviewed-app-discovery-and-eligibility-filtering/feature-spec.md)
- [CB-502 - Route, clarify, or refuse decision path](./cb-502-route-clarify-or-refuse-decision-path/feature-spec.md)
- [CB-503 - Debate Arena flagship app](./cb-503-debate-arena-flagship-app/feature-spec.md)
- [CB-504 - Multi-app continuity in a single conversation](./cb-504-multi-app-continuity-in-a-single-conversation/feature-spec.md)

## Risks

- Letting the active catalog drift away from the checked-in default runtime.
- Treating legacy Debate Arena or Story Builder proof as if it still satisfied
  the active flagship roadmap.
- Shipping Drawing Kit or Weather on top of a stale launch path or stale seed
  corpus.
- Treating `summaryForModel` alone as the final product shape instead of the
  minimum safe continuity layer for richer native app-state integration.
