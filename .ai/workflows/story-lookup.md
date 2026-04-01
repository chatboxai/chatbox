# Story Lookup Workflow

**Purpose**: Before implementing meaningful work, gather relevant project
context, official documentation, and best-practice guidance from both local docs
and targeted external sources.

## When To Run

Run after `agent-preflight` and before writing tests or implementation for:

- feature work
- bug fixes
- performance work
- security work
- deployment work

## Step 1: Define Lookup Scope

From the task, extract:

- problem to solve
- acceptance criteria
- integrations or providers involved
- non-functional constraints such as security, performance, or deployment

## Step 2: Local Lookup

Read relevant internal docs first:

1. `.ai/docs/SINGLE_SOURCE_OF_TRUTH.md`
2. `.ai/memory/project/patterns.md`
3. `.ai/memory/project/anti-patterns.md`
4. `.ai/memory/project/edge-cases.md`
5. `.ai/memory/session/active-context.md`
6. `README.md`
7. relevant repo docs for the affected surface
8. `package.json`
9. for UI work: `.ai/docs/PENCIL_UI_WORKFLOW.md`
10. for UI work: existing `design/**/*.pen` assets when they exist
11. for UI work: `.ai/skills/pencil-ui-design.md`
12. for UI work: existing `docs/specs/**/design-brief.md` artifacts when the
    story is a continuation or exemplar hunt
13. for UI work: the current code surface that may need to be imported into
    Pencil first

Capture reusable patterns and constraints from local docs.

## Step 3: External Lookup

Search official docs and best-practice sources for the task scope.

Preferred source priority:

1. official framework or provider docs
2. primary standards or specifications
3. reputable engineering references

Minimum external lookup output:

- at least 1-2 relevant external sources when the task depends on behavior not
  already well exemplified in the repo
- concrete takeaways tied to the task

## Step 4: Publish the Lookup Brief

Deliver a concise lookup brief before coding:

1. story and scope summary
2. local findings
3. external findings, when required
4. implementation implications
5. initial design-intent implications for UI work when applicable
6. risks or open questions
7. initial test strategy
8. sizing recommendation

## Exit Criteria

- local lookup completed
- external lookup completed when needed
- findings shared before implementation
