# Autonomous UI Design Workflow

Use this document when a story changes visible UI and the design direction
should be decided inside the normal story flow without pausing for human design
approval.

## Goal

Keep feature-spec and technical planning in the normal story flow, then route
visible UI through a repo-grounded design brief, targeted research, prompt-based
option generation, and an autonomous decision record before implementation.

## Core Principles

1. Design starts from user context, task intent, and codebase reality, not from
   an unbounded styling prompt.
2. Reuse existing Chatbox tokens, components, copy patterns, and layout
   conventions before inventing new visual language.
3. When the repo does not already exemplify the surface, bring in source-backed
   external research before locking the direction.
4. Generate multiple directions, but choose one autonomously with a visible
   rubric and rationale.
5. Do not pause for design approval unless the user explicitly asks for a
   review checkpoint.

## Recommended Artifact Layout

- `docs/specs/<story-id>/feature-spec.md`
- `docs/specs/<story-id>/technical-plan.md`
- `docs/specs/<story-id>/design-brief.md`
- `docs/specs/<story-id>/design-research.md`
- `docs/specs/<story-id>/design-decision.md`

If the design question is broad or strategically important, replace or augment
`design-research.md` with the existing BrainLift artifacts:

- `brainlift.md`
- `source-registry.md`
- `research-validation.md`

## Design Brief Contract

Every visible UI story needs an explicit `design-brief.md` before the design
direction is locked. The brief should answer:

1. Audience and entry context
2. Desired feeling and feelings to avoid
3. Design-language cues and anti-cues
4. System direction for color roles, typography posture, and component/surface
   character
5. Layout metaphor or hierarchy axes
6. Copy direction and copy-fidelity requirements
7. Constraints and no-go decisions
8. Prompt-ready inputs for the autonomous design pass

For small UI tweaks the brief can stay short, but each section still needs an
explicit answer.

## Research Contract

Design research is repo-first:

- inspect the current UI surface in code
- inspect adjacent screens/components and shared tokens
- inspect prior story docs when they are relevant

External research is required when any of these are true:

- the repo does not already show the relevant interaction or layout pattern
- the story introduces a new user journey, audience, or content posture
- the change depends on current external guidance, policy, or design standard
- the team needs evidence to defend one direction over another

Prefer official docs, primary standards, and authoritative UX references before
secondary commentary.

## Prompt Packet Contract

The autonomous design pass should use a structured prompt packet rather than a
single vague request. The packet should include:

- role and objective
- current surface and codebase context
- design brief summary
- research takeaways
- must-keep and must-avoid constraints
- explicit success rubric
- required output shape

Prompting rules:

- keep the instructions direct and specific
- use clear sections or delimiters
- start zero-shot, add examples only if the output format is unstable
- state the success criteria plainly

## Autonomous Option Loop

The design pass should generate 2 or 3 materially different directions in text
before choosing one. Small spacing tweaks do not count as separate options.

For each option, capture:

- a short name
- the hierarchy/layout thesis
- the component and copy posture
- key strengths
- key risks

Then score the options against a visible rubric. At minimum the rubric should
cover:

- task clarity and system status
- match to user language and user goals
- control, recovery, and error prevention
- consistency with existing Chatbox patterns
- information hierarchy and restraint
- accessibility and responsive feasibility
- implementation fit and testability

Use the scoring pass plus one critique/refinement loop to pick a winner.

## Decision Record

Write `design-decision.md` before implementation. It should show:

- the brief and research inputs used
- the options considered
- the scoring rubric
- the chosen direction and why it won
- discarded options and why they lost
- copy-fidelity status
- implementation implications for components, tokens, states, and tests

## Approval Default

This workflow is autonomous by default:

- do not stop for human design approval
- do not wait for manual selection among options
- record the chosen direction and proceed

Pause only when:

- the user explicitly asks to review design before code
- the design change would silently broaden the story beyond its accepted scope
- the available evidence is too weak to defend a direction honestly

## What Counts as a UI Story

Run this workflow when a task changes any of:

- layout
- component structure
- spacing or visual hierarchy
- color, surfaces, or typography
- visible interaction chrome or screen composition

Skip it only for:

- copy-only changes with no visual consequence
- hidden state or logic changes with no visible UI change
- implementation work that is already following an existing design decision
