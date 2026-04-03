# Autonomous UI Design Workflow

**Purpose**: Route UI design through a prompt-based, research-backed, and
autonomous decision pass after spec writing and before code implementation.

## When To Run

Run this workflow when a task changes visible UI, including:

- page or screen layout
- component composition
- spacing, typography, color, or surface treatment
- visible interaction chrome
- new UI components or significant redesigns

Skip only for:

- copy-only changes with no visual consequence
- hidden state or logic changes
- code work that is already implementing an existing design decision

## Step 1: Confirm Inputs

Before design direction is generated:

- the feature spec exists
- the technical plan exists
- the design goal and acceptance criteria are clear
- the current UI surface and closest repo exemplars have been inspected

## Step 2: Write the Design Brief

Create or refresh `docs/specs/<story-id>/design-brief.md`.

The brief must capture:

- audience and entry context
- desired feeling and feelings to avoid
- design-language cues and anti-cues
- system direction for color roles, typography posture, and surface character
- layout metaphor or hierarchy axes
- copy direction, including whether real draft copy is required
- constraints and no-go decisions
- prompt-ready design inputs

For small UI tweaks the brief can stay concise, but every section still needs
an explicit answer.

## Step 3: Gather Design Research

Start with repo evidence:

- inspect the current code surface
- inspect adjacent screens/components and shared tokens
- inspect prior story docs when they are relevant

Add external research when the repo does not already exemplify the relevant
surface, audience, or interaction pattern.

Record the findings in:

- `docs/specs/<story-id>/design-research.md`

If the question is broader or strategically important, use the BrainLift
artifacts instead of or in addition to `design-research.md`.

## Step 4: Build the Prompt Packet

Translate the brief and research into a structured design packet with:

- role and objective
- current surface and codebase constraints
- relevant repo exemplars
- research takeaways
- explicit must-keep and must-avoid rules
- success rubric
- required output shape

Keep the packet direct, specific, and sectioned. Start zero-shot and add
examples only if the output format is unstable.

## Step 5: Generate 2 or 3 Directions

Produce 2 or 3 materially different directions in text:

- vary hierarchy, density, layout, or emphasis
- map differences back to the brief's declared axes
- keep each direction grounded in existing Chatbox components and tokens when
  possible
- do not treat tiny spacing tweaks as separate options

## Step 6: Score and Refine Autonomously

Score each direction against a visible rubric that covers:

- task clarity and system status
- match to user language and user goals
- control, recovery, and error prevention
- consistency with existing Chatbox patterns
- information hierarchy and restraint
- accessibility and responsive feasibility
- implementation fit and testability

Then run one critique/refinement loop and pick a winner.

## Step 7: Record the Design Decision

Write `docs/specs/<story-id>/design-decision.md`.

It must show:

- the brief and research inputs used
- the options considered
- the scoring rubric
- the chosen direction and why it won
- discarded options and why they lost
- copy fidelity status
- implementation implications for components, states, tokens, and tests

## Step 8: Proceed Without Human Design Approval

This workflow is autonomous by default:

- do not pause for manual design review
- do not wait for the user to pick between options
- proceed after the decision record is written

Pause only when the user explicitly asks for design review, the evidence is too
weak to defend a direction, or the design change would silently expand the
story beyond the accepted scope.

## Exit Criteria

- `design-brief.md` exists before implementation
- repo-first design research was completed
- external sources were added when needed
- 2 or 3 directions were generated
- the directions were scored autonomously
- `design-decision.md` records the chosen path before code
