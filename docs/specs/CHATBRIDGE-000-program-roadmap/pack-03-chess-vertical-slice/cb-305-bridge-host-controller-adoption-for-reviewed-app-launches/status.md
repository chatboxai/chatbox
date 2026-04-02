# CB-305 Status

- status: planned
- pack: Pack 03 - Chess Vertical Slice
- single-agent order: backfill 2 of 8
- blocked by: CB-006
- unblocks: CB-508
- implementation surfaces:
  - `src/renderer/packages/chatbridge/bridge/host-controller.ts`
  - `src/renderer/components/chatbridge/apps/surface.tsx`
  - `src/renderer/components/chatbridge/chatbridge.ts`
  - `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
  - `src/renderer/components/Artifact.tsx`
- validation surfaces:
  - `test/integration/chatbridge/scenarios/`
  - bridge launch smoke traces in LangSmith
- happy-path scenario proof:
  - planned: a live reviewed-app launch uses the bridge host controller and
    renders host-owned runtime state in the ChatBridge shell
- failure or degraded proof:
  - planned: bridge startup failure degrades through the normalized host
    recovery path without falling back to a synthetic seeded shell
- acceptance-criteria status:
  - AC-1 planned
  - AC-2 planned
  - AC-3 planned
- notes:
  - Opened from `smoke-audit-master.md` finding SA-005.
  - This story restores the real reviewed-app launch seam before broader
    multi-app rebuild work continues.
  - Do not skip directly to Pack 05 implementation without closing this seam.
