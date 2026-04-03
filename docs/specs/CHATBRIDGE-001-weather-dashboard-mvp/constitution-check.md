# CHATBRIDGE-001 Constitution Check

## Story

- Story ID: CHATBRIDGE-001
- Story Title: Weather Dashboard MVP
- Date: 2026-04-02
- Author: Codex

## Why This Story Exists

The current repo does not contain a real weather dashboard implementation. The
only live weather behavior is a mocked tool-capability test in
`src/renderer/utils/model-tester.ts`. This packet defines a bounded path to a
real, host-managed weather dashboard that can prove ChatBridge app lifecycle
behavior with lower product risk than a fully guided educational workflow.

## Constraint Check

1. Host-owned lifecycle remains mandatory.
   The weather dashboard must behave like a ChatBridge app, not a free-floating
   widget or direct model prompt hack.
2. Public, no-auth scope only for MVP.
   The first version should avoid account sync, saved locations, and partner
   OAuth so the work stays focused on the app contract itself.
3. Visible UI still requires Pencil before implementation.
   The story packet can define UI scope, but implementation must stop for
   approved Pencil variations before UI code lands.
4. Seeded example refresh remains part of completion.
   If the feature ships, `src/renderer/packages/initial_data.ts` must be
   reviewed and refreshed if needed.
5. Validation stays at the repo root.
   Completion still expects `pnpm test`, `pnpm check`, `pnpm lint`,
   `pnpm build`, and `git diff --check`.

## Fit With Existing Direction

- Aligns with `chatbridge/PRESEARCH.md` by keeping the host in charge of app
  routing, state, and model-visible summaries.
- Aligns with `chatbridge/ARCHITECTURE.md` by using a reviewed-app lifecycle and
  host-mediated data flow.
- Intentionally chooses a lower-complexity second app to prove the platform
  before committing to a more policy-heavy workflow.

## Non-Goals

- Replacing the broader ChatBridge roadmap
- Designing a marketplace-grade weather integration
- Adding mapping, radar, climate analytics, or personalized saved-location
  features
- Introducing a new backend auth surface

## Verdict

Pass. This story is constitutionally compatible if it stays a host-managed,
public-data MVP and uses the standard UI approval and validation gates before
implementation.
