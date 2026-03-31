# ChatBridge Service Topology and Deployment Foundation

This document captures the Pack 0 service-topology baseline for ChatBridge.
It maps the target architecture onto the repo's current runtime seams so later
stories can attach contracts to real boundaries instead of vague future
infrastructure.

## Current Repo Runtime Shape

Today this repository is primarily a client application with desktop and web
build surfaces.

### Current layers

1. Electron main process
   - Owns privileged desktop/runtime behavior
   - Current examples:
     - `src/main/main.ts`
     - `src/main/proxy.ts`
     - `src/main/mcp/ipc-stdio-transport.ts`
     - `src/main/store-node.ts`

2. Preload bridge
   - Exposes the constrained browser-to-main bridge
   - Current example:
     - `src/preload/index.ts`

3. Renderer application
   - Owns conversation UI, model orchestration, remote request usage, and local
     interaction state
   - Current examples:
     - `src/renderer/packages/model-calls/stream-text.ts`
     - `src/renderer/packages/mcp/controller.ts`
     - `src/renderer/packages/remote.ts`

4. Shared contracts and adapters
   - Type and adapter layer used across boundaries
   - Current examples:
     - `src/shared/request/request.ts`
     - `src/shared/request/chatboxai_pool.ts`
     - `src/shared/providers/registry.ts`

### What the repo does not currently contain

- a checked-in ChatBridge backend
- a partner app registry service
- a tenant/classroom policy service
- a host-managed auth broker service for partner credentials
- a durable app-instance service separate from the local client

Those are target-state platform services, not current repo facts.

## Target ChatBridge Ownership Map

### Layer 1: Client shell

Owned by this repo's app runtime.

- conversation UI
- embedded app containers
- route transitions and visible lifecycle states
- optimistic local cache for responsiveness
- degraded-mode UX when network or partner services fail

### Layer 2: Host runtime

Initially implemented in this repo, eventually split between client logic and
backend-authoritative services.

- app-aware routing
- lifecycle state machine
- bridge validation
- tool coordination
- context injection and completion normalization
- host-owned reasoning-context reduction for active app state before it reaches
  the model path

### Layer 3: Platform services

Future backend-authoritative layer.

- reviewed app registry
- policy and eligibility
- durable conversations and app instances
- auth broker / token vault
- partner resource proxy
- audit, health, and observability control plane

### Layer 4: Partner runtime

Less trusted than the host.

- native first-party app surfaces when explicitly built in-repo
- sandboxed partner app surfaces for reviewed third-party applications

## Local Development Versus Future Hosted Authority

### Local development assumptions today

- Electron main remains the only privileged local runtime.
- Renderer owns most orchestration and remote-call composition.
- Local integration work should use mocks, fixtures, and host-owned harnesses
  instead of depending on unavailable backend services.
- `USE_LOCAL_API=true` currently means "use the local Chatbox API origin," not
  "there is already a ChatBridge control plane running locally."

### Future hosted authority assumptions

The following concerns should become backend-authoritative as ChatBridge
hardens:

- reviewed app registry and version approval
- tenant and classroom policy
- durable app-instance state and app event streams
- auth brokerage and credential handles
- audit and kill-switch controls
- health and partner-operating telemetry

### Important rule

When a Pack 1+ story needs one of these future backend concerns before a real
service exists, the story should:

1. name the missing service explicitly
2. define the host-side temporary mock or adapter
3. avoid pretending local state is the final source of truth

## Deployment Foundation

### What ships from this repo today

- desktop builds through `electron-builder.yml`
- web builds through `build:web` in `package.json`
- a checked-in Vercel host contract through `vercel.json`
- a static smoke artifact at `/healthz.json` generated during `pnpm build:web`
- local desktop dev through `pnpm dev`
- local web smoke validation through `pnpm serve:web`

### What is not yet a real deployment surface for ChatBridge

- a deployed registry service
- a deployed policy service
- a deployed partner auth broker
- a deployed app-instance or event persistence layer

### Current deployment-related gaps

- the repo still does not contain the future ChatBridge backend services listed
  above
- the hosted Phase 0 surface is the host shell, not the final platform control
  plane

## Recommended Service Boundaries For Later Packs

### In-repo surfaces to extend first

- future `src/main/chatbridge/` for privileged host-runtime concerns
- `src/shared/chatbridge/` now exists for shared execution-contract types and
  host-owned tool normalization helpers; later packs can extend it with
  manifest, bridge-session, lifecycle, and reasoning-context contracts
- `src/shared/chatbridge/chess.ts` now carries the host-owned Chess snapshot,
  legal-move, and board-summary helper contract used by both seeded fixtures
  and the live runtime surface
- future `src/renderer/components/chatbridge/` and
  `src/renderer/packages/chatbridge/` for renderer-side lifecycle/UI
- `src/renderer/components/chatbridge/apps/chess/` now holds the native
  board-first Chess runtime that persists moves back through the host-owned
  message part

### Backend-facing adapters to introduce before full services

- registry client adapter
- policy resolver adapter
- auth broker adapter
- app instance / event store adapter
- audit / observability sink adapter

These adapters let the host runtime grow without binding early stories to a
single backend implementation too soon.

## Risks To Carry Forward

- treating the renderer as the final authority for durable app state
- treating local mocks as proof that backend responsibilities are unnecessary
- skipping an explicit adapter boundary and hard-coding future service calls
- assuming deployment automation exists because the package scripts mention it

## Dependencies

- `chatbridge/BOOTSTRAP.md`
  for env and setup assumptions
- `chatbridge/DEPLOYMENT.md`
  for the concrete web-host and desktop-release contract
- `chatbridge/ARCHITECTURE.md`
  for the target presentation-level system design
- Pack 02 and later stories should use this document when deciding whether a
  concern belongs in host runtime code, a backend-facing adapter, or a future
  hosted service
