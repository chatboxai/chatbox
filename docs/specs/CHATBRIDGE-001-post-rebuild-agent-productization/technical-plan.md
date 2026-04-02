# ChatBridge Post-Rebuild Agent Productization Technical Plan

## Metadata

- Story ID: CHATBRIDGE-001
- Story Title: Post-rebuild agent productization and Ghostfolio-parity initiative
- Author: Codex
- Date: 2026-04-02

## Current State

ChatBridge now has substantial platform primitives:

- typed manifest, registry, policy, auth, resource-proxy, tool, memory, and
  recovery contracts in `src/shared/chatbridge/`
- a bridge session host controller in
  `src/renderer/packages/chatbridge/bridge/host-controller.ts`
- live UI shell rendering in `src/renderer/components/chatbridge/`
- LangSmith-backed tracing and a manual smoke harness

The remaining architectural gap is not "missing contracts." It is "missing
unification and productization."

The current smoke-led rebuild queue still identifies live runtime gaps in:

- reviewed app launch spine
- active runtime catalog transition
- non-Chess invocation path
- route / clarify / refuse live UI
- final session console/accessibility cleanup

This initiative therefore begins only after those queue items close.

## Proposed Design

### Phase 1: Unified Execution Governor

Create one host-owned execution layer that becomes the runtime entry point for:

- reviewed app discovery
- route decision
- launch preparation
- bridge session lifecycle
- tool mounting and execution wrapping
- completion handoff
- degraded recovery handoff

Likely landing zones:

- `src/main/chatbridge/governor/`
- `src/shared/chatbridge/governor-contract.ts`
- `src/renderer/packages/chatbridge/runtime/`
- `src/renderer/packages/model-calls/stream-text.ts`

### Phase 2: Backend-Authoritative State and Reconciliation

Move durable platform truth away from renderer-only assumptions.

Focus areas:

- conversation-linked app instance persistence
- durable app event records
- revision or offset-based reconciliation
- host-owned resume and replay rules
- explicit local-cache versus backend-truth boundaries

Likely landing zones:

- `src/main/chatbridge/state-store/`
- `src/shared/chatbridge/app-records.ts`
- `src/renderer/packages/chatbridge/app-records.ts`
- any later backend or service adapter seam required by deployment work

### Phase 3: Operator/Admin/Feedback Productization

Turn the existing trace/audit foundation into inspectable product surfaces.

Focus areas:

- app health/readiness summaries
- recent failure/recovery surfaces
- lightweight feedback intake tied to app/runtime state
- operational review views for kill switches, audit summaries, and trace links

Likely landing zones:

- `src/main/chatbridge/ops/`
- `src/shared/chatbridge/observability.ts`
- `src/renderer/components/chatbridge/admin/`
- `src/renderer/routes/` admin/operator surfaces if they become visible

### Phase 4: Architecture and Runtime Truth Sync

Update checked-in architectural truth so it matches the active runtime.

Focus areas:

- flagship-app set
- runtime topology
- trusted boundaries
- supported live smoke flows
- legacy references clearly marked as legacy

Likely docs:

- `chatbridge/PRESEARCH.md`
- `chatbridge/ARCHITECTURE.md`
- `chatbridge/README.md`
- `chatbridge/EVALS_AND_OBSERVABILITY.md`
- `docs/specs/CHATBRIDGE-000-program-roadmap/*`

### Phase 5: Policy and Refusal Layer

Only after the above phases stabilize should ChatBridge introduce a stronger
governor-level policy/refusal model comparable to Ghostfolio.

Focus areas:

- pre-orchestration refusal checks
- post-tool argument auditing
- refusal contracts visible in runtime behavior

### Phase 6: Verification / Confidence / Provenance

Add a real output-verification layer for agent responses.

Focus areas:

- verification metadata on app/tool results
- confidence policy
- provenance/source display for externally grounded flows such as Weather
- response-level aggregation instead of raw model prose

### Phase 7: High-Risk Action Workflow

Leave this last.

Focus areas:

- preview / confirm / execute
- side-effect governance
- execution audit trails
- explicit kill switches for write-capable app actions

## Architecture Decisions

- Decision: treat this as a second initiative after the rebuild queue, not as
  more Pack 05 backfill.
- Decision: prioritize control-plane unification and durable state over policy
  polish and confidence presentation.
- Decision: defer write-action workflow until the product has stable read and
  orchestration behavior.

## Test Strategy

- Unit tests:
  unified governor contracts, state reconciliation logic, operator health
  reducers, later-phase refusal/verification contracts
- Integration tests:
  runtime entrypoint -> bridge launch -> app event persistence -> recovery
  transitions -> operator surface state
- E2E or smoke:
  manual smoke should prove governor-owned launch and resume behavior before the
  policy/verification phases begin

## Risks

- A governor phase can become a rewrite if it is not forced to adopt existing
  typed seams instead of replacing them.
- Backend-authoritative state can sprawl if the storage boundary is specified
  before the minimal platform truth model is agreed.
- Operator surfaces can degrade into trace viewers if they are not scoped to
  concrete product questions.
- Policy/refusal and verification can bloat the initiative if they are not kept
  as later, separate phases.
