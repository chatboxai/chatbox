# Story Sizing Workflow

**Purpose**: Classify a task so small bounded changes use a proportionate lane
and larger work gets fuller planning.

## Step 1: Apply the Trivial Classifier

A task is `trivial` only when all of these are true:

- the intended change is tightly bounded
- no public contract changes
- no schema, migration, deployment, or config contract changes
- no new dependency or tooling introduction
- no architecture or workflow change beyond the directly affected files

If any condition fails, classify the task as `standard`.

## Step 2: Publish the Lane Decision

State explicitly:

- `lane: trivial` or `lane: standard`
- why the task did or did not qualify
- which gates will be skipped or still required

## Step 3: Route the Task

### If `trivial`
- go directly to focused TDD or the bounded mechanical edit

### If `standard`
- use the fuller story workflow with lookup, specs when needed, and broader
  validation

## Exit Criteria

- lane classification recorded
- skipped gates called out explicitly
