# TDD Workflow (Three-Agent Pipeline)

## Purpose

Enforce test-first delivery for behavior changes by isolating test design,
implementation, and refactor review into separate stages.

## Non-Negotiables

- No implementation without a failing test first.
- Every bug fix starts with a reproducing test or a clearly documented manual
  reproduction when a test is not practical yet.
- Agent 1 writes the contract without implementation-aware shortcuts.
- Agent 2 does not modify Agent 1 tests.
- Agent 3 refactors only while keeping tests green.
- Use `.ai/workflows/tdd-pipeline.md` as the canonical pipeline.

## Pipeline

### 1) Initialize
- Create `.ai/state/tdd-handoff/<story-id>/` as the handoff boundary.
- Keep stage context isolated to files on disk, not prior reasoning.

### 2) Agent 1 - RED Contract
- Use `.ai/agents/tdd-spec-interpreter.md`.
- Write adversarial tests from the spec and existing test conventions.
- Run a focused test command and prove it fails for the expected reason.

### 3) Agent 2 - GREEN Implementation
- Use `.ai/agents/tdd-implementer.md`.
- Implement the minimum code needed to satisfy Agent 1's fixed tests.
- Record objections in `agent2-escalations/` instead of editing the tests.

### 4) Optional Property or Mutation Gates
- For data transforms, sorting/filtering, or state transitions, add property
  tests when the stack supports them.
- Use mutation testing only when the repo already has a stable way to run it.

### 5) Agent 3 - Review and Refactor
- Use `.ai/agents/tdd-reviewer.md`.
- Review code plus test results, then refactor only while keeping the suite
  green.

## Completion Criteria

- New behavior is specified by Agent 1 tests, not implementation-aware
  assumptions.
- RED and GREEN checkpoints are recorded in the handoff folder.
- Optional quality gates are either run or explicitly skipped with a reason.
- All relevant suites pass after Agent 3 review.
