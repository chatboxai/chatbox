# Pencil UI Workflow

Use this document when a story changes visible UI and the design needs review
before implementation.

## Goal

Keep feature spec and technical planning in the normal story flow, then add a
story-level design brief before Pencil so the design starts from audience,
feeling, design language, system direction, layout metaphor, and copy
direction rather than a vague prompt.

## Non-Negotiable Preflight

Before using Pencil for a story:

1. Run:
   `python3 .ai/scripts/sync_pencil_docs.py`
2. Review:
   `.ai/reference/pencil/ESSENTIALS.md`
3. Review the synced local snapshots for:
   - `getting-started/ai-integration`
   - `design-and-code/design-to-code`
   - `for-developers/the-pen-format`
   - `for-developers/pencil-cli`
4. Review any story-specific pages that matter:
   components, slots, design libraries, variables, import/export, or interface
   docs

Do not use Pencil from memory alone.

Review the Pencil CLI docs as a reference for tool behavior and MCP-backed
operations, not because this workflow expects direct shell CLI usage.

## Prerequisites

- Pencil is running locally.
- A `.pen` file is open in Pencil.
- Codex can see Pencil in `/mcp`.
- The story already has a feature spec, technical plan, and
  `docs/specs/<story-id>/design-brief.md`, or an equivalent scoped story
  contract plus a committed plan to write the design brief before variations.

Do not rely on the harness to auto-provision Pencil config. Pencil's own docs
note Codex config duplication issues, so setup should stay manual and verified.
The desktop app plus MCP is the default and expected path for this repo. Do not
use direct shell `pencil` availability as the normal readiness check; verify
Pencil through `/mcp` instead.

Live-update rule:

- Pencil's documented "see changes reflected in the canvas immediately"
  behavior applies when AI uses Pencil MCP tools against the active editor
  session.
- Do not expect raw on-disk edits to a `.pen` file from outside Pencil to
  hot-reload in the open desktop UI.
- If live visual feedback matters, prefer MCP-backed design operations over
  direct file patching.
- If a `.pen` file must be patched directly on disk, assume Pencil may need the
  file reopened or reloaded before the canvas reflects the new state.

## Schema Guardrails

These are easy to get wrong and must be checked before editing `.pen` files:

- `frame` supports flexbox-style layout; if a frame is meant to behave like an
  absolute artboard or free-positioned composition, set `layout: "none"`.
- `x` and `y` are ignored when the parent uses layout.
- `text` width or height should not be set without `textGrowth`.
- Reusable components, `ref`, `descendants`, and `slot` should carry shared
  design patterns instead of duplicating raw node trees.

If a story file is being hand-authored or hand-patched, explicitly re-check
these rules in the synced `.pen` docs snapshot first.

## MCP Configuration Notes

This workspace expects Pencil through a local MCP server connected to the
desktop app, typically with:

- `name`: `pencil`
- `transport`: `stdio`
- `args`: `["--app", "desktop"]`

Do not treat the exact desktop-binary path as durable repo configuration when it
comes from a macOS `AppTranslocation` path. Verify availability through `/mcp`
in the active session instead of checking a transient absolute path into the
repo.

Operational default:

- Pencil MCP is the bridge this workflow should assume.
- Direct shell CLI use is optional and unusual here; do not probe for it first.
- If MCP is available, proceed with Pencil through MCP even if the shell does
  not expose a `pencil` binary.

## Recommended Artifact Layout

- `docs/specs/<story-id>/feature-spec.md`
- `docs/specs/<story-id>/technical-plan.md`
- `docs/specs/<story-id>/design-brief.md`
- `docs/specs/<story-id>/pencil-review.md`
- `design/system/design-system.lib.pen` for shared variables, components, and
  slots
- `design/stories/<story-id>.pen` for story-specific explorations

The `design/` paths are the checked-in locations for this repo's shared library
and story-specific Pencil assets.

## Design Brief Contract

Every visible UI story needs a concise but explicit `design-brief.md` before
variations begin. The brief must answer:

1. Audience and entry context:
   who is landing on the surface and why now
2. Desired feeling:
   what the user should feel, plus feelings to avoid
3. Design-language translation:
   5 to 8 concrete material, spatial, editorial, or interaction cues plus
   anti-cues
4. System direction:
   the job of neutral, primary, secondary, and accent roles; typography
   posture; and component or surface character
5. Layout metaphor:
   a physical-object or editorial analogy and the axes that should vary across
   variations
6. Copy direction:
   voice, naming, CTA posture, and whether real draft copy is required
7. Constraints and no-go decisions:
   implementation, content, accessibility, or scope constraints
8. Pencil prompt inputs:
   the short prompt-ready phrases that should guide the variations

For bounded UI tweaks the brief can be short, but every section still needs an
explicit answer.

## Design-System Standard

Use `.ai/docs/PENCIL_DESIGN_SYSTEM_STANDARD.md` when updating
`design/system/design-system.lib.pen`.

Important:

- Do not call the library `comprehensive` unless it meets the standard.
- If the library is only tokens plus a handful of components, label it honestly
  as `starter`.
- Story work should extend the library before inventing one-off story-only UI
  language.

## Pencil Tools to Prefer

- `batch_get` for structure and component inspection
- `batch_design` for creating or modifying design elements
- `get_screenshot` for review images
- `snapshot_layout` for layout sanity checks
- `get_editor_state` for active-file and selection context
- `get_variables` and `set_variables` for design-system tokens

## Variables and Design Tokens

When the story changes shared tokens:

- import existing code-side variables or token files into Pencil first when
  practical
- update the shared Pencil variables from that baseline
- after approval, sync the chosen token changes back to code

Do not let Pencil variables and code-side tokens drift silently.

## Required Flow

1. Sync the official Pencil docs locally and review the relevant snapshots.
2. Write or refresh the feature spec and technical plan first.
3. Write or refresh `docs/specs/<story-id>/design-brief.md` before opening
   variation work.
4. For existing UI surfaces, import the current code into Pencil first so the
   baseline reflects the real app before variations begin.
5. Confirm whether the story should extend an existing Pencil design library or
   add one as the foundation.
6. Build or update shared Pencil variables, components, and slots first, then
   create the story-specific screen or component work from that foundation.
7. For live design work, make the actual design mutations through Pencil MCP on
   the open file rather than patching the `.pen` JSON on disk.
8. Produce 2 or 3 materially different variations, not just one draft plus tiny
   tweaks. Variation differences should map back to the layout metaphor or
   hierarchy axes declared in the design brief.
9. Use real library-backed components where possible; if a variation is mostly
   placeholder geometry, label it as wireframe-grade in the review packet.
10. When the story introduces or materially changes content, do not label an
    option `design-grade` if it still relies on generic placeholder headings or
    CTAs. Use real draft copy or mark the copy fidelity honestly. If copy is
    unchanged, record `N/A`.
11. Capture screenshots and short tradeoff notes for each variation.
12. Write `docs/specs/<story-id>/pencil-review.md`.
13. Present the variations to the user and stop for approval or tweaks.
14. Only after approval, update the technical plan with the chosen variation and
    proceed to implementation.

## Approval Gate

For UI stories, implementation is blocked until one of these is true:

- the user approves a Pencil variation,
- the user asks for specific tweaks and then approves the revised version,
- or the task is explicitly downgraded to non-visual UI work only.

Do not treat "I think this looks good" as approval. The review artifact should
show which variation was chosen, which `design-brief.md` guided it, and any
requested tweaks.

## Design to Code After Approval

Once a variation is approved:

- either implement manually against the approved `.pen` artifact,
- or use Pencil's design-to-code flow to generate a first pass and then adapt it
  to the repo's real stack and conventions.

When asking Pencil to generate code, specify the actual stack and libraries in
use for the touched surface rather than a generic stack.

## What Counts as a UI Story

Run this workflow when a task changes any of:

- layout
- component structure
- spacing or visual hierarchy
- color, surfaces, or typography
- visible interaction chrome or screen composition

Skip it only for:

- copy-only changes
- hidden state or logic changes with no visual change
- implementation work that is already following an approved Pencil design
