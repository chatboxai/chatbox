# CB-605 Status

- status: planned
- pack: Pack 06 - Authenticated Apps and Story Builder
- single-agent order: parked legacy packet
- blocked by: CB-305, CB-506
- unblocks: full live Story Builder smoke and authenticated-app proof
- implementation surfaces:
  - `src/main/chatbridge/auth-broker/index.ts`
  - `src/main/chatbridge/resource-proxy/index.ts`
  - `src/shared/chatbridge/story-builder.ts`
  - `src/renderer/components/chatbridge/apps/story-builder/StoryBuilderPanel.tsx`
  - `src/renderer/components/chatbridge/apps/surface.tsx`
  - `src/renderer/components/chatbridge/chatbridge.ts`
- validation surfaces:
  - `test/integration/chatbridge/scenarios/story-builder-lifecycle.test.ts`
  - `test/integration/chatbridge/scenarios/resource-proxy-access.test.ts`
  - live Story Builder smoke traces in LangSmith
- happy-path scenario proof:
  - planned: Story Builder launches live, requests auth through the host,
    performs mediated resource access, saves, resumes, and completes
- failure or degraded proof:
  - planned: auth denial, handle expiry, and resource failure remain visible,
    recoverable, and host-owned in the live runtime
- acceptance-criteria status:
  - AC-1 planned
  - AC-2 planned
  - AC-3 planned
- notes:
  - Opened from `smoke-audit-master.md` finding SA-004.
  - Story Builder is now considered a legacy reference app after the
    2026-04-02 active catalog change.
  - Keep this packet for future reactivation work, but it is no longer on the
    active flagship queue unless product direction changes again.
