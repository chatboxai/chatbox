# Cursor Agent - Chatbox Workspace Entry Guide

## Purpose

Ensure Cursor follows the same orchestration contract as Claude and Codex.

## Required Startup Order

1. Read `.ai/docs/SINGLE_SOURCE_OF_TRUTH.md`
2. Read `.ai/codex.md`
3. Read `.ai/agents/claude.md`
4. Route to the correct workflow in `.ai/workflows/`

## Required Gates

- New task preflight gate: run `agent-preflight` before non-trivial edits
- Story lookup gate: run `.ai/workflows/story-lookup.md`
- Story sizing gate: run `.ai/workflows/story-sizing.md`
- Pencil UI gate: run `.ai/workflows/pencil-ui-design.md` for UI-affecting
  stories after spec/plan and before implementation
- TDD gate for behavior changes: run `.ai/workflows/tdd-pipeline.md`
- AI-architecture gate for `.ai/` changes: run
  `.ai/workflows/ai-architecture-change.md`
- Completion gate: run `.ai/workflows/story-handoff.md`
- Completion gate output must explain what changed, where it changed, and how
  the user should inspect and test it. UI stories must include route or
  component inspection guidance and the expected visible result.

## Task Routing

- Feature: `.ai/workflows/feature-development.md`
- Bug fix: `.ai/workflows/bug-fixes.md`
- Performance: `.ai/workflows/performance-optimization.md`
- Security: `.ai/workflows/security-review.md`
- Deployment: `.ai/workflows/deployment-setup.md`
- UI design and review: `.ai/workflows/pencil-ui-design.md`
- Git finalization: `.ai/workflows/git-finalization.md`

## Shared Standards

Cursor should follow the same standards in:

- `.ai/skills/code-standards.md`
- `.ai/skills/pencil-ui-design.md`
- `.ai/skills/spec-driven-development.md`
- `.ai/skills/tdd-workflow.md`
- `.ai/skills/security-checklist.md`
- `.ai/skills/performance-checklist.md`
