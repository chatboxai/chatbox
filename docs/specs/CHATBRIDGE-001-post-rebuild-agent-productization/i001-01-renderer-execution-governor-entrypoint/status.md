# I001-01 Status

- status: validated
- initiative: CHATBRIDGE-001 Post-rebuild agent productization
- phase: I001 Unified execution governor
- blocked by: none
- unblocks:
  - later `I001` slices that absorb bridge lifecycle and completion/recovery
    handoff
  - `I002` backend-authoritative state and reconciliation
- implementation surfaces:
  - `src/shared/chatbridge/governor-contract.ts`
  - `src/shared/chatbridge/index.ts`
  - `src/renderer/packages/chatbridge/runtime/execution-governor.ts`
  - `src/renderer/packages/model-calls/stream-text.ts`
  - `src/renderer/packages/chatbridge/single-app-tools.ts`
- validation surfaces:
  - `src/renderer/packages/chatbridge/runtime/execution-governor.test.ts`
  - `src/renderer/packages/model-calls/stream-text.test.ts`
  - `test/integration/chatbridge/scenarios/execution-governor-entrypoint.test.ts`
  - LangSmith project `chatbox-chatbridge`
  - repo gates:
    - `pnpm test`
    - `pnpm check`
    - `pnpm lint`
    - `pnpm build`
    - `git diff --check`
- happy-path scenario proof:
  - `test/integration/chatbridge/scenarios/execution-governor-entrypoint.test.ts`
  - representative trace proof:
    - `chatbridge.eval.chatbridge-execution-governor-entrypoint.doc-proof-invoke`
      -> `8d01b575-c38d-4a9b-9abc-8756a10c71f1`
- failure or degraded proof:
  - `test/integration/chatbridge/scenarios/execution-governor-entrypoint.test.ts`
  - representative trace proof:
    - `chatbridge.eval.chatbridge-execution-governor-entrypoint.doc-proof-clarify`
      -> `69b5faac-aa99-4db1-bd75-8dc95132e88d`
    - `chatbridge.eval.chatbridge-execution-governor-entrypoint.doc-proof-refuse`
      -> `22edce16-6f28-4c3e-86ca-c95b63b7d87e`
- acceptance-criteria status:
  - AC-1 met:
    `streamText` now delegates reviewed route preparation, tool wrapping, trace
    event emission, and output normalization through
    `src/renderer/packages/chatbridge/runtime/execution-governor.ts`.
  - AC-2 met:
    `src/shared/chatbridge/governor-contract.ts` now defines the shared
    selection-source, route-resolution, and trace-payload contract used by the
    new seam.
  - AC-3 met:
    explicit Drawing Kit invoke and natural Chess fallback remain green through
    `test/integration/chatbridge/scenarios/execution-governor-entrypoint.test.ts`.
  - AC-4 met:
    clarify and refuse artifacts still appear through the governor seam with
    the stable `chatbridge.routing.reviewed-app-decision` event contract.
  - AC-5 met:
    this story does not move app-record durability to backend truth and does
    not replace the bridge host controller lifecycle seam.
- notes:
  - This is the first bounded implementation story after the `CHATBRIDGE-000`
    rebuild queue completed.
  - No `src/renderer/packages/initial_data.ts` refresh was needed because this
    story changes runtime seam ownership and trace proof, not seeded example
    behavior.
