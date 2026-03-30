# CB-001 Technical Plan

## Metadata

- Story ID: CB-001
- Story Title: Service topology and deployment foundation
- Author: Codex
- Date: 2026-03-30

## Proposed Design

- Components/modules affected:
  - `chatbridge/README.md`
  - `chatbridge/SERVICE_TOPOLOGY.md`
  - `chatbridge/PRESEARCH.md`
  - `chatbridge/ARCHITECTURE.md`
  - `electron-builder.yml`
  - `src/preload/index.ts`
  - `src/main/mcp/ipc-stdio-transport.ts`
  - `src/renderer/packages/mcp/controller.ts`
  - future `src/main/chatbridge/`
  - future service adapters and deployment docs
- Public interfaces/contracts:
  - host/service/runtime ownership map
  - local-dev versus backend-authoritative responsibility map
  - deployment dependency assumptions for later packs
- Data flow summary:
  Electron host owns user experience -> platform services own governance and
  persistence -> partner runtimes stay bounded by the host

## Architecture Decisions

- Decision:
  lock the topology early so feature stories do not invent inconsistent runtime
  ownership later
- Alternatives considered:
  - defer deployment thinking until late integration
  - treat all early ChatBridge work as local-only without service boundaries
- Rationale:
  lifecycle, auth, and policy work all depend on where authority actually lives

## Data Model / API Contracts

- Request shape:
  topology inputs come from current repo boundaries and the checked-in
  architecture
- Response shape:
  a clear ownership and deployment map for future stories
- Storage/index changes:
  documentation-only foundation story

## Concrete Boundary Map

- Electron main process:
  privileged desktop runtime, IPC handlers, local OS/network integration
- Preload:
  constrained bridge between renderer and privileged main process
- Renderer:
  chat UX, orchestration, remote request composition, local interactive state
- Future hosted platform services:
  registry, policy, auth broker, durable app instances, audit, health

## Known Topology Gaps

- The repo does not yet contain a ChatBridge backend or service adapters.
- `package.json` references release shell scripts that are not present in the
  repo root.
- Later stories must distinguish "future backend authority" from "current local
  mock or adapter" instead of collapsing them into one layer.

## Dependency Plan

- Existing dependencies used:
  current Electron, preload, renderer, and request layers
- New dependencies proposed (if any):
  none at this stage
- Risk and mitigation:
  stay architecture-aligned and avoid vendor-specific assumptions this early

## Test Strategy

- Unit tests:
  N/A for docs-only planning
- Integration tests:
  future service-boundary smoke checks can hang from this topology
- E2E or smoke tests:
  none yet
- Edge-case coverage mapping:
  local-only fallback, hosted-service dependency gaps

## UI Implementation Plan

- Behavior logic modules:
  N/A
- Component structure:
  none
- Accessibility implementation plan:
  none
- Visual regression capture plan:
  none

## Rollout and Risk Mitigation

- Rollback strategy:
  update the topology docs as service decisions harden
- Feature flags/toggles:
  later packs may use flags for hosted-service rollout
- Observability checks:
  topology should leave room for trace and telemetry attachment points

## Validation Commands

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
git diff --check
```
