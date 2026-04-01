# DEMO-PENCIL-001 Technical Plan

## Current State

`src/renderer/routes/about.tsx` currently renders:

- a version/update/legal card
- an optional zh-Hans warning card
- a community/contact list
- a support/resources list

The page already uses the right shell pattern:

- `Page` for title-bar layout
- `Container` and `Stack` for page composition
- Chatbox CSS variables through Mantine colors and utility classes

## Approved-Design Implementation Strategy

After a variation is approved, implement the chosen layout in
`src/renderer/routes/about.tsx` with the existing stack and the approved
design brief:

1. Keep the route and existing link destinations intact.
2. Restructure the page into stronger visual groups instead of two flat lists.
3. Continue using Mantine primitives already present in the file:
   `Container`, `Stack`, `Flex`, `Text`, `Title`, `Button`, `Anchor`,
   `Divider`, `Popover`, `Image`.
4. Continue using Chatbox tokens from `globals.css` instead of introducing new
   ad hoc colors.
5. Preserve the current version card content, legal links, and WeChat QR
   behavior.
6. Preserve the zh-Hans warning block as a first-class section.

## Likely Code Changes After Approval

- `src/renderer/routes/about.tsx`
  Main implementation surface.

Possible but optional follow-up files if the approved direction benefits from
extraction:

- `src/renderer/routes/about/-components/*.tsx`
  Only if the final layout becomes unwieldy in one file.

## Implementation Notes

- Prefer re-grouping current content over inventing new product promises.
- Reuse existing labels where possible to avoid expanding translation scope.
- If implementation introduces new user-facing copy, add translation keys rather
  than hard-coding English.
- Keep click targets and `platform.openLink(...)` behavior unchanged.

## Validation Plan

When implementation begins:

1. Run `pnpm lint`
2. Run `pnpm check`
3. Smoke-check the About route in the app
4. Verify both large-screen and small-screen layouts

## Risks

- The current About page copy is translation-backed in places and inline in
  others, so adding new copy too early could widen scope.
- The best demo outcome is to preserve all current destinations while changing
  only hierarchy and grouping.

## Current Gate

No implementation work should start yet. This story is paused at the Pencil
variation approval step, with `docs/specs/DEMO-PENCIL-001/design-brief.md`
serving as the direction contract for the review.
