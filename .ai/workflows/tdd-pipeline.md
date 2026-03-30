# TDD Pipeline Workflow

**Purpose**: Replace single-agent red-green-refactor with an isolated
three-stage TDD pipeline that uses files on disk as the handoff boundary.

## When To Run

Run this workflow for implementation tasks that add or change tests and
production code.

## Step 1: Initialize Handoff Storage

Create the story handoff structure under:

```text
.ai/state/tdd-handoff/<story-id>/
```

Use `.ai/state/tdd-handoff/README.md` as the reference layout.

## Step 2: Agent 1 - Spec Interpreter / Test Author

Use:

- `.ai/agents/tdd-spec-interpreter.md`

Allowed context:

- story spec or acceptance criteria
- public API surface only
- existing tests for conventions

Required outputs:

- example-based tests in the story scope
- adversarial edge cases
- `agent1-meta.json`

## Step 3: RED Guard

Run the focused test command and require it to fail before Agent 2 starts.

If tests pass immediately:

- stop
- record the unexpected green result
- strengthen the contract or confirm the behavior already exists

## Step 4: Agent 2 - Implementer

Use:

- `.ai/agents/tdd-implementer.md`

Allowed context:

- Agent 1 test files from disk
- full repo codebase
- story spec

Forbidden behavior:

- modifying Agent 1 test files
- silently weakening the contract

After each attempt, require the focused tests to go green.

## Step 5: Optional Quality Gates

When the story shape warrants it:

- add property tests for transforms or state-heavy logic
- run mutation testing only if the repo already supports it cleanly

## Step 6: Agent 3 - Reviewer / Refactorer

Use:

- `.ai/agents/tdd-reviewer.md`

Required outputs:

- refactored implementation when warranted
- missing-test recommendations
- `agent3-quality.json`

Agent 3 must leave the suite green.

## Step 7: Handoff Requirements

Before broader validation:

- handoff directory exists
- Agent 1/2/3 metadata is present
- escalations are explicit on disk

Then continue with:

- repo validation commands
- `.ai/workflows/story-handoff.md`

## Exit Criteria

- RED and GREEN guards recorded on disk
- Agent 2 did not modify Agent 1 tests
- optional quality gates were run or explicitly skipped
