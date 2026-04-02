# CB-306 Technical Plan

## Scope

Repair the user-visible Chess launch chain:

1. selection for explicit and natural Chess prompts
2. tool-result normalization for Chess launch records
3. renderer handoff into the real Chess runtime
4. regression coverage proving Chess bypasses the generic reviewed-launch shell
   while other reviewed apps still use it

## Existing Seams

- Selection and tool creation:
  - `src/shared/chatbridge/single-app-discovery.ts`
  - `src/renderer/packages/chatbridge/single-app-tools.ts`
- Tool-result normalization:
  - `src/renderer/packages/chatbridge/reviewed-app-launch.ts`
- Chess runtime and snapshot helpers:
  - `src/shared/chatbridge/apps/chess.ts`
  - `src/renderer/packages/chatbridge/chess-session-state.ts`
  - `src/renderer/components/chatbridge/apps/chess/ChessRuntime.tsx`
- Generic reviewed-launch bridge surface:
  - `src/renderer/components/chatbridge/apps/ReviewedAppLaunchSurface.tsx`
  - `src/renderer/packages/chatbridge/bridge/reviewed-app-runtime.ts`

## Proposed Changes

### 1. Tighten Chess selection

- Extend `resolveReviewedSingleAppSelection(...)` so raw FEN, PGN-like move
  lists, and common natural Chess requests such as “best move” or “opening
  analysis” remain on the Chess tool path.
- Keep generic board-game prompts ambiguous.

### 2. Convert Chess tool results into real Chess app parts

- Add a Chess-specific branch in `reviewed-app-launch.ts` when a successful
  reviewed host-tool result targets `appId === "chess"`.
- Build a host-owned Chess snapshot from:
  - `fen` when valid
  - otherwise `pgn` when valid
  - otherwise the starting position
- Normalize `startpos` to the starting position.
- Materialize a normal Chess app part instead of a reviewed-launch bridge part.

### 3. Preserve generic reviewed-launch behavior for non-Chess apps

- Keep the current generic reviewed-launch part path for Drawing Kit, Weather,
  and any later reviewed apps that still rely on the bridge-launch shell.
- Update the generic reviewed-launch tests to use a non-Chess reviewed app so
  the contract remains explicitly covered.

### 4. Add regression coverage

- Selection/unit:
  - explicit Chess tool wording
  - raw FEN and PGN-like prompts
- Tool/result normalization:
  - `chess_prepare_session` becomes a Chess runtime part
  - malformed FEN/PGN fail closed to a safe starting snapshot or explicit
    rejection path
  - non-Chess reviewed apps still produce reviewed-launch parts
- Integration:
  - `streamText(...)` with a tool-calling model returns a Chess app part whose
    snapshot is a valid Chess board state
- UI:
  - `ChatBridgeMessagePart` renders the actual Chess runtime for a tool-launched
    Chess app part

## Trace/Eval Plan

- Keep the current reviewed-app decision trace at the selection layer.
- Add a focused regression scenario for the Chess runtime handoff path under
  `test/integration/chatbridge/scenarios/`.
- Confirm the scenario leaves a named trace family entry so manual smoke and
  automated evidence agree on what the Chess path now does.

## Risks

- If the Chess-specific handoff leaks into non-Chess reviewed apps, future
  Drawing Kit / Weather work will inherit the wrong assumptions.
- If malformed FEN/PGN are treated as trusted input, the host can fabricate
  invalid board state.
- If the direct Chess handoff drops the host-owned summary/model context
  behavior, later-turn reasoning can regress.

## Validation

- Focused:
  - `pnpm exec vitest run src/shared/chatbridge/single-app-discovery.test.ts src/renderer/packages/chatbridge/single-app-tools.test.ts src/renderer/packages/chatbridge/reviewed-app-launch.test.ts src/renderer/components/chatbridge/ChatBridgeMessagePart.test.tsx test/integration/chatbridge/scenarios/chess-runtime-launch-handoff.test.ts`
- Full repo:
  - `pnpm test`
  - `pnpm check`
  - `pnpm lint`
  - `pnpm build`
  - `git diff --check`
