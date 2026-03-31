# CB-001 Constitution Check

## Story Context

- Story ID: CB-001
- Story Title: Service topology and deployment foundation
- Pack: Pack 00 - Foundation and Instrumentation
- Owner: Codex
- Date: 2026-03-30

## Constraints

1. Keep ChatBridge Electron-first and repo-grounded.
   Source: `chatbridge/PRESEARCH.md`, `chatbridge/ARCHITECTURE.md`
2. Treat deployment and service boundaries as explicit design choices before
   feature work depends on them.
   Source: `chatbridge/SERVICE_TOPOLOGY.md`, `chatbridge/DEPLOYMENT.md`
3. Do not imply a production topology that the repo and presearch do not
   support.
   Source: `chatbridge/ARCHITECTURE.md`, `chatbridge/SERVICE_TOPOLOGY.md`

## Structural Map

- `chatbridge/PRESEARCH.md`
- `chatbridge/ARCHITECTURE.md`
- `chatbridge/DEPLOYMENT.md`
- `src/main/`
- `src/preload/`
- `src/renderer/`

## Exemplars

1. `chatbridge/SERVICE_TOPOLOGY.md`
2. `chatbridge/DEPLOYMENT.md`
3. `chatbridge/ARCHITECTURE.md`

## Lane Decision

- Lane: `standard`
- Why: this sets the foundation for later runtime, service, and deployment
  assumptions.
- Required gates: full four-artifact packet.
