# Spec-Driven Development Skill

## Purpose

Use this skill to keep larger stories spec-anchored and test-driven.

If the request is not yet story-ready, do the upstream shaping work first:

- use `.ai/workflows/product-building.md` for new products, new verticals, or
  significant features with open scope
- use `.ai/workflows/brainlift-research.md` when the decision needs defended
  research before the spec can stabilize

Reference playbook:
- `.ai/docs/research/spec-driven-tdd-playbook.md`
- `.ai/docs/UI_DESIGN_WORKFLOW.md` for UI work

## Non-Negotiable Rules

1. Do not write implementation code before the story contract is clear.
2. Do not write production code before failing tests exist for the next
   behavior when the task changes behavior.
3. Do not add behavior not present in the accepted scope.
4. Keep specs and implementation synchronized.
5. Refactor only after tests are green.

## Four-Artifact Contract

For standard-lane feature work, create or update:

1. Constitution check
2. Feature spec
3. Technical plan
4. Task breakdown

Recommended location:
- `docs/specs/<story-id>/`

For program or phase-pack planning, a nested story packet is also valid:
- `docs/specs/<program-id>/<pack-id>/<story-id>/`

Rule:
- the pack folder may hold the planning set for many future stories
- each individual story inside that pack still needs its own four-artifact
  packet
- once a story becomes the active implementation track, it can stay nested or
  be promoted to `docs/specs/<story-id>/`, but the four-artifact contract must
  remain intact either way

## SDD -> TDD Handoff

Before coding, derive a test list from acceptance criteria:

- happy-path behaviors
- edge conditions
- failure modes
- integration boundaries

Then run `.ai/workflows/tdd-pipeline.md` manually:

1. Agent 1 writes failing tests from the spec and public API surface only.
2. Prove RED with a focused test command.
3. Agent 2 implements the minimum code without editing Agent 1 tests.
4. Agent 3 reviews/refactors and leaves the suite green.

## UI Guidance

For UI scope:

- keep the normal feature spec and technical plan
- use `.ai/workflows/autonomous-ui-design.md` for the design brief, research,
  and decision pass
- use `UI_DESIGN_BRIEF_TEMPLATE.md`, `UI_DESIGN_RESEARCH_TEMPLATE.md`, and
  `UI_DESIGN_DECISION_TEMPLATE.md` as needed
- record the chosen direction before implementation rather than pausing for
  manual approval

Separate:
- **Behavior layer**: test-driven state, events, validation, conditional
  rendering, accessibility behavior.
- **Visual layer**: prompt-driven design intent, research, option scoring, and
  implementation of the recorded decision.

## Done Criteria

A story is done only when:

- Spec artifacts are current for the chosen scope.
- Tests cover the accepted behavior.
- Validation passes.
- Handoff reflects the final behavior and risks.
