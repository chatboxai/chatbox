# Pack 07 - Error Handling, Safety, and Partner DX

> Summary mirror only. Use the canonical folder:
> `pack-07-policy-safety-and-partner-dx/`

## Phase Fit

- Phase: 7 of 7
- Primary objectives: O3, O5
- Unlocks: tenant policy enforcement, platform-wide recovery, auditability,
  kill switches, partner tooling, reviewed-app operating model

## Pack Goal

Finish ChatBridge as a governable platform rather than a successful demo by
adding policy precedence, platform-wide error handling, safety operations,
observability, and developer tooling for reviewed partners.

## Entry Gates

- The three flagship app classes are already proven:
  long-lived state, educational workflow, and authenticated partner flow.
- Core lifecycle, routing, completion, and auth contracts already exist.

## Stories

### CB-701 Tenant policy engine with classroom overrides

- Goal:
  enforce district hard-denies, teacher/classroom narrowing, and stale-policy
  fail-closed behavior.
- Acceptance focus:
  app eligibility becomes a policy decision, not a convenience setting.
- Likely surfaces:
  new policy domain modules,
  router inputs,
  registry enablement logic.

### CB-702 Observability, health, kill switches, and rollback controls

- Goal:
  expose app launch/completion/error signals, per-app health, version kill
  switches, and safe disablement.
- Acceptance focus:
  operators can respond to bad partner behavior without code changes.
- Likely surfaces:
  audit/health event emitters,
  host runtime telemetry,
  app registry version control surfaces.

### CB-703 Privacy-aware audit trail and safety operations

- Goal:
  log the right events with redaction, retention, and minimal raw student
  content by default.
- Acceptance focus:
  accountability exists without drifting into unnecessary surveillance.
- Likely surfaces:
  audit event schemas,
  logging utilities,
  host normalization paths.

### CB-704 Partner SDK, manifest validator, and local harness

- Goal:
  give reviewed partners a concrete way to build correctly against the platform.
- Acceptance focus:
  manifest schema, bridge tooling, mock host harness, and debugging guidance
  exist before partner scale-out.
- Likely surfaces:
  new partner-facing docs and validator modules,
  local mock app fixtures,
  developer tooling.

### CB-705 Platform-wide error handling and recovery

- Goal:
  define the host-owned failure and recovery contract for timeouts, crashes,
  invalid tool calls, malformed bridge traffic, and degraded resume paths.
- Acceptance focus:
  platform failures have a consistent, explainable recovery model instead of
  one-off app-specific fallbacks.
- Likely surfaces:
  app instance recovery state,
  bridge/tool error normalization,
  degraded timeline UI and recovery tests.

## Exit Criteria

- Policy precedence is enforceable and explainable.
- Unsafe or broken partner versions can be disabled safely.
- Platform-wide failures have a consistent host-owned recovery path.
- Audit and safety operations are privacy-aware by default.
- Partner developers have a documented, validated path to build reviewed apps.

## Risks

- Treating safety and observability as launch polish instead of platform
  contract
- Logging too much raw content in the name of supportability
- Scaling partner breadth without a validator or local harness
