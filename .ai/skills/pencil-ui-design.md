# Pencil UI Design Skill

## Purpose

Use this skill when a story changes visible UI and the design needs to be
explored and approved in Pencil before code implementation.

## When to Use

Use this skill when the task changes:

- screen layout
- component structure
- visual hierarchy
- spacing, typography, color, or surfaces
- visible interaction chrome

Do not use it for:

- copy-only changes
- hidden logic changes
- code work that is already implementing an approved Pencil design

## Non-Negotiable Rules

1. Sync Pencil docs locally with `python3 .ai/scripts/sync_pencil_docs.py`
   before every Pencil story.
2. Review `.ai/reference/pencil/ESSENTIALS.md` and the relevant synced docs
   pages before editing `.pen` files.
3. Treat Pencil MCP as the default bridge; verify Pencil in `/mcp` instead of
   probing for a direct shell `pencil` command as the normal path.
4. When live visual feedback matters, make design changes through Pencil MCP on
   the open file instead of patching the `.pen` file directly on disk.
5. Keep feature spec and technical plan in the normal story flow.
6. Do not do visual exploration in code first.
7. For existing UI surfaces, import the current code into Pencil before
   exploring changes.
8. Base UI exploration on the shared Pencil design library when it exists.
9. Use `.ai/docs/PENCIL_DESIGN_SYSTEM_STANDARD.md` to judge library maturity
   honestly; do not call a starter library comprehensive.
10. Produce 2 or 3 materially different variations.
11. Present the variations and wait for explicit user approval or tweak requests.
12. Do not implement UI code before approval.
13. If a frame is acting as a free-positioned artboard, set `layout: "none"`
    explicitly.

## Output Contract

For each UI story:

- sync the official Pencil docs into `.ai/reference/pencil/`
- record which synced docs pages were reviewed
- verify Pencil is running and visible in `/mcp`
- prefer MCP-backed design mutations on the active file when live updates in
  Pencil matter
- import the existing code surface into Pencil first when the story is modifying
  an existing UI
- update or extend the shared `design-system.lib.pen` foundation when needed
- create or update the story-specific `.pen` file
- capture screenshots for each variation
- write `docs/specs/<story-id>/pencil-review.md`
- record which option was approved and any requested tweaks
- decide whether post-approval implementation should be manual or use Pencil's
  code export as a starting point

## Variation Rules

- Use the same variables/components across the variations when possible.
- Make the options meaningfully different in hierarchy, density, or composition.
- Do not present fake variety like tiny spacing shifts only.
- Use real library-backed components where possible.
- If an option is mostly placeholders, say so explicitly in the review packet.

## Approval Gate

Implementation is blocked until:

- the user selects a variation, or
- the user requests revisions and then approves the revised design

If Pencil is unavailable, stop and surface the blocker instead of silently
falling back to ad hoc design in code.
