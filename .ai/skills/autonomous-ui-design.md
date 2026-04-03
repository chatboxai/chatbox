# Autonomous UI Design Skill

## Purpose

Use this skill when a story changes visible UI and the design direction should
be established through prompt-based exploration and research rather than a
tool-specific design session or manual approval gate.

## When To Use

- new screens or significant layout changes
- component redesigns
- UI work that needs stronger design intent before code
- stories where repo patterns alone are not enough to defend a direction

Skip for:

- copy-only changes with no visual impact
- hidden logic changes
- implementation work that is already following a recorded design decision

## Workflow

1. Run `.ai/workflows/autonomous-ui-design.md`
2. Write `design-brief.md`
3. Gather repo-first design research and external sources when needed
4. Build a structured prompt packet with constraints and a scoring rubric
5. Generate 2 or 3 materially different directions
6. Score them autonomously, refine once, and record the winner
7. Proceed to implementation without waiting for design approval

## Output Contract

- `design-brief.md`
- `design-research.md` or BrainLift artifacts when needed
- `design-decision.md`
- clear implementation implications for components, states, tokens, and tests
