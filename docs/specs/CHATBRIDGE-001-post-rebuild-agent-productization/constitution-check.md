# CHATBRIDGE-001 Constitution Check

## Story

Define the next ChatBridge initiative after the current rebuild queue so the
product can move from "runtime repaired" to "agent platform productized."

## Constraints

1. Keep `CHATBRIDGE-000` as the canonical active roadmap and do not replace it.
   Source:
   `docs/specs/CHATBRIDGE-000-program-roadmap/feature-spec.md`
2. Do not interfere with the active rebuild queue; this packet must begin only
   after the queue closes.
   Source:
   `docs/specs/CHATBRIDGE-000-program-roadmap/progress.md`
3. Preserve the real ChatBridge runtime seams already established in:
   `src/shared/chatbridge/`,
   `src/renderer/packages/chatbridge/`,
   `src/main/chatbridge/`.
   Source:
   `docs/specs/CHATBRIDGE-000-program-roadmap/progress.md`
4. The initiative should respond to the actual smoke-audit and runtime gap
   findings, not the stale “all done” narrative.
   Source:
   `docs/specs/CHATBRIDGE-000-program-roadmap/smoke-audit-master.md`
5. Respect the user-directed priority order: policy/refusal, verification, and
   high-risk action workflow are later phases, not early phases.
   Source:
   current user instruction in this thread, captured in this packet

## Structural Map

- Current active roadmap:
  `docs/specs/CHATBRIDGE-000-program-roadmap/`
- Post-rebuild initiative packet:
  `docs/specs/CHATBRIDGE-001-post-rebuild-agent-productization/`
- Current runtime seams:
  - `src/shared/chatbridge/`
  - `src/renderer/packages/chatbridge/`
  - `src/renderer/components/chatbridge/`
  - `src/main/chatbridge/`

## Relevant Exemplars

1. `docs/specs/CHATBRIDGE-000-program-roadmap/feature-spec.md`
   The canonical example of a standalone ChatBridge initiative packet.
2. `docs/specs/CHATBRIDGE-000-program-roadmap/progress.md`
   The control layer showing that the rebuild queue is still active.
3. `docs/specs/CHATBRIDGE-000-program-roadmap/smoke-audit-master.md`
   The evidence base that justifies a second initiative after the queue closes.

## Runtime Truth Being Preserved

- Typed registry and manifest contracts:
  `src/shared/chatbridge/registry.ts`
- Policy evaluation seam:
  `src/shared/chatbridge/policy.ts`
- Host tool contract:
  `src/shared/chatbridge/tools.ts`
- Bridge lifecycle seam:
  `src/renderer/packages/chatbridge/bridge/host-controller.ts`
- Auth/resource primitives:
  `src/main/chatbridge/auth-broker/index.ts`
  `src/main/chatbridge/resource-proxy/index.ts`
- Structured UI shell:
  `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
  `src/renderer/components/chatbridge/ChatBridgeShell.tsx`

## Initiative Decision

The new initiative should not be framed as “finish the old plan.” It should be
framed as:

- post-rebuild control-plane unification
- durable-state authority
- operator productization
- truth sync
- later policy/refusal
- later verification/confidence
- final high-risk action workflow
