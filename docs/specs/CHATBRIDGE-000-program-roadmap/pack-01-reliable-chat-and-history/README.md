# Pack 01 - Reliable Chat and History

## Phase Fit

- Phase: 1 of 7
- Primary objectives: O1, O2
- Unlocks: app-capable timeline artifacts, host-owned embedded runtime shell, and durable session groundwork for later packs

## Pack Goal

Stabilize the current chat/session substrate so app-backed artifacts can live inside a thread without breaking persistence, export, or recovery semantics.

## Entry Gates

- ChatBridge presearch and architecture are accepted as the design direction.
- The existing Chatbox session/message model is treated as the baseline to extend, not as throwaway scaffolding.

## Stories

- [CB-101 - Session durability baseline](./cb-101-session-durability-baseline/feature-spec.md)
- [CB-102 - App-capable message part schema](./cb-102-app-capable-message-part-schema/feature-spec.md)
- [CB-103 - Host-owned app container shell](./cb-103-host-owned-app-container-shell/feature-spec.md)
- [CB-104 - App-aware persistence regression coverage](./cb-104-app-aware-persistence-regression-coverage/feature-spec.md)

## Exit Criteria

- App-aware timeline state has a clear persistence path.
- The host has a dedicated embedded-app container seam.
- Regression coverage exists for reload, thread history, and export-sensitive paths.

## Risks

- Breaking existing chat persistence while adding app-aware message parts.
- Treating iframe rendering as sufficient before durability rules are explicit.
- Creating a second storage model that diverges from current session/thread truth.
