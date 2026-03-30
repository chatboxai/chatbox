# Example Specialist Agent - Replace During Setup

## Purpose
This file is an example specialist playbook from the source workspace.

The template is stack-agnostic. During setup, either:
- replace this file with a specialist agent relevant to the project,
- rename it to match the chosen system concern,
- or remove it if it is not needed.

## Suitable Specialist Agent Topics
- search/retrieval systems,
- data pipelines,
- realtime systems,
- mobile performance,
- developer tooling,
- domain-specific evaluation.

## Example Delegation Prompt
```text
@specialist-agent: Optimize [system concern/use case].
Constraints: [project-specific goals from setup]
Return: experiment plan, risks, and implementation steps.
```
