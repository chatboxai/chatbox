# DEMO-PENCIL-001 Constitution Check

## Story

Run a real, low-risk UI story through the new Pencil-first workflow using the
existing About page as the target surface.

## Constraints

1. Keep visible UI work in the normal story flow: feature spec, technical plan,
   and design brief first, then Pencil review before implementation.
   Source: `.ai/docs/PENCIL_UI_WORKFLOW.md`
2. UI implementation is blocked until a Pencil variation is approved.
   Source: `.ai/workflows/pencil-ui-design.md`
3. Match existing repo patterns instead of inventing a parallel design system in
   code. The current About page is a Mantine route wrapped in `Page` and uses
   Chatbox CSS variables and utility classes.
   Sources:
   `src/renderer/routes/about.tsx`,
   `src/renderer/components/layout/Page.tsx`,
   `src/renderer/static/globals.css`
4. Use the repo's real quality gates when implementation starts.
   Sources:
   `package.json` scripts `lint`, `check`, `test`
5. Do not disturb unrelated worktree changes.
   Source:
   current `git status --short --branch`

## Structural Map

- UI routes live in `src/renderer/routes/`
- Layout wrappers live in `src/renderer/components/layout/`
- Visual tokens live in `src/renderer/static/globals.css`
- Story artifacts for this harness demo live in `docs/specs/DEMO-PENCIL-001/`
- Pencil assets for this harness demo live in `design/system/` and
  `design/stories/`

## Exemplars

1. `src/renderer/routes/about.tsx`
   The target screen and the clearest exemplar for the final implementation.
2. `src/renderer/components/layout/Page.tsx`
   The page-shell pattern used by static routed surfaces.
3. `src/renderer/static/globals.css`
   The source of truth for color, spacing, and radius tokens.

## Demo Decision

The demo story is intentionally small and static:

- no new APIs
- no new data stores
- no routing changes
- no behavior changes beyond the visible About page composition
- no design-language invention outside the shared Chatbox token and component
  posture

That makes it a good proof run for the approval-gated Pencil workflow.
