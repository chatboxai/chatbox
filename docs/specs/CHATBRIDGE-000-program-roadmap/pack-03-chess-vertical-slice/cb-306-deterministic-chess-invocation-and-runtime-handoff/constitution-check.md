# CB-306 Constitution Check

## Scope Discipline

- This story fixes the broken Chess launch experience exposed by live smoke and
  user repro.
- It does not replace `CB-506`; non-Chess live reviewed-app invocation remains
  in the Pack 05 queue.

## Contract Boundaries

- Shared selection and launch normalization changes stay under
  `src/shared/chatbridge/` and `src/renderer/packages/chatbridge/`.
- The user-visible result must reuse the existing Chess runtime surface in
  `src/renderer/components/chatbridge/apps/chess/`.
- Generic reviewed-launch behavior for non-Chess apps must remain intact.

## Safety Rules

- Only host-created Chess snapshots may populate trusted app state.
- Invalid FEN/PGN must not silently become trusted board state.
- The fix must not reintroduce demo-grade placeholders for live Chess launch.

## Testing Rules

- Include a focused success path for tool-launched Chess.
- Include a malformed-input or degraded-path test.
- Preserve at least one regression test proving non-Chess reviewed apps still
  use the generic reviewed-launch seam.

## UI Rules

- No new design language is introduced here.
- Reuse the approved Chess runtime UI rather than making a new launch card.

## Merge Gate

- Story docs updated
- Focused tests green
- Full repo validation green
- Story merged to `main`
