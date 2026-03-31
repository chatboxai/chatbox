# Pack 00 - Foundation and Instrumentation

## Phase Fit

- Phase: 0 of 7
- Primary objectives: foundation for O1 through O5
- Unlocks: environment readiness, deployment/bootstrap shape, provider/app
  integration setup, evals, tracing, observability, and trace-driven
  development

## Pack Goal

Create the foundation required before ChatBridge feature work begins: local and
deployment setup, integration and secret contracts, and baseline eval/trace
instrumentation so later packs can be built and debugged with observable
evidence.

## Entry Gates

- ChatBridge is accepted as a platform initiative, not a throwaway prototype.
- The team wants trace/eval support available before orchestration-heavy work
  starts.

## Stories

- [CB-000 - Workspace bootstrap and env contract](./cb-000-workspace-bootstrap-and-env-contract/feature-spec.md)
- [CB-001 - Service topology and deployment foundation](./cb-001-service-topology-and-deployment-foundation/feature-spec.md)
- [CB-002 - Integration harness and provider fixtures](./cb-002-integration-harness-and-provider-fixtures/feature-spec.md)
- [CB-003 - Evals, tracing, and observability foundation](./cb-003-evals-tracing-and-observability-foundation/feature-spec.md)
- [CB-004 - Web deployment and release infrastructure baseline](./cb-004-web-deployment-and-release-infrastructure-baseline/feature-spec.md)

## Exit Criteria

- Environment and secret requirements are explicit.
- Deployment and service-boundary assumptions are captured.
- A real hosted Phase 0 web shell exists with a checked-in provider config and
  smoke path.
- Root release entrypoints exist for the web shell and desktop publishing
  surfaces.
- Provider/app integration fixtures exist for development and tests.
- Trace, eval, and observability hooks exist early enough to support
  trace-driven development in later packs.
- The core Pack 0 artifacts exist in `chatbridge/` and the starter ChatBridge
  integration test home exists under `test/integration/chatbridge/`.

## Risks

- Starting platform work before env and service assumptions are explicit.
- Treating tracing and evals as late-stage polish instead of foundation.
- Leaving integration setup implicit and discovering missing keys/contracts only
  during flagship app work.
