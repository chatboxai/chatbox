# Pack 07 - Error Handling, Safety, and Partner DX

Operational tracking: [`STATUS.md`](./STATUS.md)

## Phase Fit

- Phase: 7 of 7
- Primary objectives: O3, O5
- Unlocks: tenant policy enforcement, privacy-aware auditability, kill switches, partner tooling, and the operating model for reviewed app scale-out

## Pack Goal

Finish ChatBridge as a governable platform rather than a successful demo by
adding policy precedence, platform-wide error handling, safety operations,
observability, and partner developer tooling.

## Entry Gates

- The three flagship app classes are already proven: game state, educational workflow, and authenticated app flow.
- Core lifecycle, routing, completion, and auth contracts already exist.

## Stories

- [CB-701 - Tenant policy engine with classroom overrides](./cb-701-tenant-policy-engine-with-classroom-overrides/feature-spec.md)
- [CB-702 - Observability, health, kill switches, and rollback controls](./cb-702-observability-health-kill-switches-and-rollback-controls/feature-spec.md)
- [CB-703 - Privacy-aware audit trail and safety operations](./cb-703-privacy-aware-audit-trail-and-safety-operations/feature-spec.md)
- [CB-704 - Partner SDK, manifest validator, and local harness](./cb-704-partner-sdk-manifest-validator-and-local-harness/feature-spec.md)
- [CB-705 - Platform-wide error handling and recovery](./cb-705-platform-wide-error-handling-and-recovery/feature-spec.md)

## Single-Agent Order

1. CB-701
2. CB-703
3. CB-705
4. CB-702
5. CB-704

## Exit Criteria

- Policy precedence is enforceable and explainable.
- Unsafe or broken partner versions can be disabled safely.
- Platform-wide failures have a consistent host-owned recovery path.
- Partners have a documented and validated path to build reviewed apps correctly.

## Risks

- Treating safety and observability as launch polish instead of platform contract.
- Capturing too much raw student content in the name of supportability.
- Scaling partner breadth without a validator or local harness.
