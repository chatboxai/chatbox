# CB-506 Status

- status: validated
- pack: Pack 05 - Multi-App Routing and Debate Arena
- single-agent order: backfill 5 of 9
- blocked by: CB-508
- unblocks: CB-509
- implementation surfaces:
  - `src/renderer/packages/model-calls/stream-text.ts`
  - `src/renderer/packages/chatbridge/single-app-tools.ts`
  - `src/shared/chatbridge/single-app-discovery.ts`
- validation surfaces:
  - `src/shared/chatbridge/single-app-discovery.test.ts`
  - `src/renderer/packages/chatbridge/single-app-tools.test.ts`
  - `test/integration/chatbridge/scenarios/live-reviewed-app-invocation.test.ts`
  - LangSmith project `chatbox-chatbridge`
  - repo gates:
    - `pnpm test`
    - `pnpm check`
    - `pnpm lint`
    - `pnpm build`
    - `git diff --check`
- happy-path scenario proof:
  - `test/integration/chatbridge/scenarios/live-reviewed-app-invocation.test.ts`
  - representative trace proof:
    - `chatbridge.eval.chatbridge-live-reviewed-app-invocation-cb-506-doc-proof-active-drawing`
      -> `38c2a2bc-c130-45d1-9bb2-34cae03fe574`
    - `chatbridge.eval.chatbridge-live-reviewed-app-invocation-cb-506-doc-proof-natural-chess`
      -> `decc2258-ea15-4db5-8355-e4dd1d9f4986`
- failure or degraded proof:
  - `src/renderer/packages/chatbridge/single-app-tools.test.ts`
  - representative trace proof:
    - `chatbridge.eval.chatbridge-live-reviewed-app-invocation-cb-506-doc-proof-failure`
      -> `a1ad56b1-d843-4e98-9be8-4dc258459dc4`
- acceptance-criteria status:
  - AC-1 satisfied via `createReviewedSingleAppToolSet(...)` now consuming the
    reviewed route decision first instead of exposing Chess as the only
    executable reviewed tool.
  - AC-2 satisfied via explicit Drawing Kit prompts now producing the reviewed
    `drawing_kit_open` host tool in the live path without seed-only setup.
  - AC-3 satisfied via route-decision trace events in `stream-text.ts` plus
    explicit host-tool error normalization for reviewed launch failures.
  - AC-4 satisfied via expanded natural Chess detection for FEN, PGN, opening
    analysis, and best-move phrasing, with a narrow Chess fallback when the
    reviewed router would otherwise clarify.
- notes:
  - Opened from `smoke-audit-master.md` finding SA-002.
  - The live invocation helper now grants the default renderer path only the
    `session.context.read` reviewed permission, which is enough for Chess and
    Drawing Kit while leaving Weather Dashboard for the later Pack 05 work.
  - `CB-507` still owns clarify/refuse renderer UI; `CB-506` only repairs the
    invoke path and the traceable failure contract.
  - No `src/renderer/packages/initial_data.ts` refresh was required because
    this story changes runtime routing and host-tool wiring, not seeded example
    content.
