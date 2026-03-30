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
   Source: requested build strategy
3. Do not imply a production topology that the repo and presearch do not
   support.
   Source: `chatbridge/ARCHITECTURE.md`

## Structural Map

- `chatbridge/PRESEARCH.md`
- `chatbridge/ARCHITECTURE.md`
- `src/main/`
- `src/preload/`
- `src/renderer/`

## Exemplars

1. `chatbridge/ARCHITECTURE.md`
2. `chatbridge/PRESEARCH.md`
3. `src/main/`

## Lane Decision

- Lane: `standard`
- Why: this sets the foundation for later runtime, service, and deployment
  assumptions.
- Required gates: full four-artifact packet.
