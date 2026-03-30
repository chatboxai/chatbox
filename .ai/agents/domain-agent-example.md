# Example Domain Agent - Replace During Setup

## Purpose
This file is an example of a project-specific domain specialist.

The template is stack-agnostic. During setup, either:
- replace this file with a real domain agent for the project,
- rename it to match the chosen domain,
- or remove it if no domain specialist is needed.

## What a Domain Agent Should Capture
- domain vocabulary and invariants,
- domain-specific edge cases,
- relevant data structures and naming conventions,
- what tests and validations are critical for the domain.

## Example Delegation Prompt
```text
@domain-agent: Review [domain-specific task].
Provide: domain rules, edge cases, and implementation risks.
```
