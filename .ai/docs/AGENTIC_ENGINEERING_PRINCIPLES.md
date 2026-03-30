# Agentic Engineering Principles for Workspace Templates

## Goal

Keep agent usage fast, predictable, and testable by shrinking context and making end conditions explicit.

## 1) Minimal context by default

- Keep instruction files short and focused.
- Prefer defaults over tool-heavy stacks.
- Add new skills/rules only when a repeated pain point proves value.
- Remove or consolidate stale instructions when context drift appears.

## 2) Separate research from implementation

When a task is not yet scoped, split work into two agents/steps:

1. **Research step**: evaluate options and constraints.
2. **Implementation step**: execute only with the selected approach.

This prevents assumption-filling and keeps implementation context tight.

## 3) Use neutral prompts for discovery tasks

Avoid prompting for a known outcome.

Examples:

- Instead of: “find bugs”
- Use: “review the logic and report issues with severity and evidence”

This reduces confirmation pressure and improves signal quality.

## 4) Define a completion contract

Every meaningful story should have an explicit contract before work starts.

Recommended contract items:

- Commands/tests to pass (or verification checks).
- Output/state expectations.
- What must change and what must stay unchanged.
- Failure handling if checks fail.

Agents should treat the contract as the task termination condition.

## 5) Favor short, iterative sessions

- Run one contract per session.
- Prefer short retries over long-running context-sticky runs.
- Periodically prune rules/skills to keep the active context clean.

## How to apply in this workspace

- `AGENTS.md` and workflow docs should remain concise.
- `spec`, `workflow`, and `validation` files describe required gates; prompt language should remain neutral and explicit.
- `TASK_CONTRACT`-style documentation can be used for any story to stop prompt drift.
