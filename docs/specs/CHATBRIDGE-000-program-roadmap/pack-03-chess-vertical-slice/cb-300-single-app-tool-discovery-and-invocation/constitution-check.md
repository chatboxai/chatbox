# CB-300 Constitution Check

## Story Context

- Story ID: CB-300
- Story Title: Single-app tool discovery and invocation
- Pack: Pack 03 - Chess Vertical Slice
- Owner: Codex
- Date: 2026-03-30

## Constraints

1. This story must satisfy the requested priority step for a single app's tool
   discovery and invocation before UI embedding expands further.
   Source: requested build strategy
2. Reuse the reviewed manifest and host-coordinated tool execution contracts.
   Sources:
   `docs/specs/CHATBRIDGE-000-program-roadmap/pack-02-platform-contract-and-bridge-security/cb-201-reviewed-app-manifest-and-registry-contract/feature-spec.md`,
   `docs/specs/CHATBRIDGE-000-program-roadmap/pack-02-platform-contract-and-bridge-security/cb-204-host-coordinated-tool-execution-contract/feature-spec.md`
3. Keep the host authoritative for routing and execution.
   Source: `chatbridge/PRESEARCH.md`

## Structural Map

- `src/renderer/packages/model-calls/stream-text.ts`
- `src/shared/models/abstract-ai-sdk.ts`
- `src/renderer/packages/chatbridge/`
- `src/shared/chatbridge/`

## Exemplars

1. `src/renderer/packages/model-calls/stream-text.ts`
2. `src/shared/models/abstract-ai-sdk.ts`
3. `src/renderer/components/message-parts/ToolCallPartUI.tsx`

## Lane Decision

- Lane: `standard`
- Why: this is a core platform execution story that changes routing and tool
  behavior boundaries.
- Required gates: full four-artifact packet before implementation.
