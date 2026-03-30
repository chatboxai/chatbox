# Pencil UI Design Workflow

**Purpose**: Route UI design through Pencil after spec writing and before code
implementation.

## When To Run

Run this workflow when a task changes visible UI, including:

- page or screen layout
- component composition
- spacing, typography, color, or surface treatment
- visible interaction chrome
- new UI components or significant redesigns

Skip only for:

- copy-only changes
- hidden state or logic changes
- code work that is already implementing an approved Pencil design

## Step 1: Confirm Inputs

Before opening Pencil:

- sync Pencil docs locally with `python3 .ai/scripts/sync_pencil_docs.py`
- review `.ai/reference/pencil/ESSENTIALS.md`
- the feature spec exists
- the technical plan exists
- the design goal and acceptance criteria are clear

At minimum, review the synced local snapshots for:

- AI Integration
- Design ↔ Code
- The .pen Format
- Pencil CLI

If the story touches components, libraries, slots, variables, or import/export,
review those synced pages too.

Use the Pencil CLI docs as reference material for the shared tool surface. Do
not treat them as a requirement to invoke `pencil` directly from the shell.

## Step 2: Confirm Pencil Availability

- start Pencil
- open the relevant `.pen` file
- verify Pencil appears in `/mcp`

If Pencil is unavailable, stop and surface the blocker.

Pencil MCP is the default bridge for this workflow. Do not start by checking
for a direct shell `pencil` command; `/mcp` is the readiness check that
matters.

Important distinction:

- Live Pencil canvas updates are expected when the design is changed through
  Pencil MCP on the active file.
- Direct edits to the `.pen` file on disk from outside Pencil should not be
  treated as a live-refresh workflow.
- If a direct patch is unavoidable, expect to reopen or reload the file in
  Pencil before the canvas catches up.

## Step 3: Ground Existing UI in Pencil First

If the task changes an existing screen or component:

- import the current code into Pencil first
- verify the imported baseline is close enough to the real UI before exploring
  variations
- for live editing, prefer MCP-backed mutations on the open file instead of
  direct `.pen` file patching

## Step 4: Start From the Shared Design Library

- reuse `design/system/design-system.lib.pen` when it exists
- import existing code-side variables or token files into Pencil first when the
  story changes shared tokens
- extend shared variables/components first
- use slots and reusable components when the pattern benefits from them
- avoid building each story as an isolated one-off design language
- use `.ai/docs/PENCIL_DESIGN_SYSTEM_STANDARD.md` to judge whether the library
  is still `starter`, `working`, or truly `comprehensive`
- do not describe the library as comprehensive unless it meets that standard

Guardrail:

- if a frame is being used like an artboard or absolute-positioned composition,
  set `layout: "none"` explicitly instead of relying on defaults

## Step 5: Produce 2 or 3 Variations

Create 2 or 3 materially different variations for the story in Pencil:

- vary hierarchy, density, layout, or emphasis
- keep them grounded in the same shared design system
- do not treat tiny spacing tweaks as separate options
- use real library-backed components where possible
- if a variation is mostly placeholder blocks, label it as wireframe-grade

## Step 6: Capture Review Evidence

For each variation:

- capture a screenshot
- note the main strengths
- note the main tradeoffs

Write the review packet in:

- `docs/specs/<story-id>/pencil-review.md`

Use:

- `.ai/templates/spec/PENCIL_VARIATION_REVIEW_TEMPLATE.md`

## Step 7: Present and Pause

Present the variations to the user and stop for:

- approval of one option, or
- requests for revisions

Do not proceed to implementation until the user explicitly approves.

## Step 8: Lock the Approved Direction

After approval:

- record the selected variation and requested tweaks
- update the technical plan with the approved design reference
- sync approved token changes back to code when the story changed shared
  variables
- decide whether implementation should be manual or start from Pencil's code
  export
- proceed to implementation and TDD as usual

## Exit Criteria

- the official Pencil docs were synced locally for this story
- the relevant Pencil docs snapshots were reviewed
- Pencil was available and used through MCP
- 2 or 3 variations were produced
- a review packet was written
- user approval or revision feedback was captured before implementation
