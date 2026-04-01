# Pencil Essentials

This is the high-signal operational summary for Pencil work in this repo. It is
derived from the official docs snapshot under `.ai/reference/pencil/pages/`.

## Must-Sync Rule

- Run `python3 .ai/scripts/sync_pencil_docs.py` at the start of every Pencil
  story.
- Record the sync timestamp in the story's `pencil-review.md`.
- Write or refresh `docs/specs/<story-id>/design-brief.md` before opening
  variation work.

## Schema Guardrails

Source:
`pages/for-developers/the-pen-format/index.md`

- `frame` objects support flexbox-style layout; if a frame is meant to behave
  like an absolute-positioned artboard, set `layout: "none"`.
- `group` defaults to `layout: "none"`, but `frame` does not.
- `x` and `y` are ignored when a parent uses layout. Do not expect absolute
  positioning inside flex parents.
- Do not set `width` or `height` on `text` nodes unless `textGrowth` is set
  first.
- Use reusable components, `ref`, `descendants`, and `slot` intentionally.
  Avoid one-off raw duplicates when the pattern should live in the library.

## Design-System Mechanics

Sources:
`pages/core-concepts/components/index.md`,
`pages/core-concepts/slots/index.md`,
`pages/core-concepts/design-libraries/index.md`,
`pages/core-concepts/variables/index.md`

- Shared UI primitives belong in a `.lib.pen` library file.
- Reusable components should carry the design language; story files should
  mostly compose them instead of sketching from raw rectangles every time.
- Use slots for container patterns that are meant to accept child components.
- Keep tokens semantic and theme-aware when practical.
- Sync shared Pencil variables with code-side tokens when a story changes them.

## Design-Intent Rules

- Every visible UI story needs `design-brief.md` before variations start.
- The brief should translate abstract feeling into concrete cues the design can
  actually express: audience, desired feeling, anti-feelings, design language,
  system direction, layout metaphor, and copy direction.
- Variation differences should respond to the brief's declared hierarchy or
  layout axes instead of arbitrary styling drift.

## Design ↔ Code Rules

Source:
`pages/design-and-code/design-to-code/index.md`

- For existing UI, import the current code into Pencil first before exploring
  changes.
- For new UI, extend the shared library first, then compose the story surface.
- After approval, either implement manually from the approved design or use
  Pencil export as a first pass and adapt it to the repo's real conventions.

## AI / MCP Rules

Sources:
`pages/getting-started/ai-integration/index.md`,
`pages/for-developers/pencil-cli/index.md`

- Pencil MCP should be visible before UI design work starts.
- Codex/Pencil work should use real MCP-backed design files, not imagined
  geometry.
- Pencil MCP is the default bridge for this repo's workflow.
- Review the CLI docs because they describe the shared tool surface, not
  because direct shell `pencil` usage is required on every story.
- Do not treat missing shell `pencil` availability as a blocker when Pencil is
  available through MCP.
- Pencil's documented immediate canvas updates should be assumed for MCP-backed
  edits to the active file, not for arbitrary external disk edits to `.pen`
  files.
- If a `.pen` file is modified outside Pencil, the safe assumption is that the
  open desktop UI may need a reopen or reload before reflecting that change.

## Review Rules

- Story files must contain 2 or 3 materially different options.
- Variations should be grounded in the same shared design system.
- Placeholder-only blocks are allowed for explicit wireframe exploration, but
  they must be labeled honestly and should not be presented as finished
  production-ready design work.
- A `design-grade` review cannot rely on generic placeholder headings or CTAs
  when the story changes content. Use real draft copy or mark copy fidelity
  honestly. If copy is unchanged, record `N/A`.
