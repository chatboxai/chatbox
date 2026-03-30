# TDD Handoff State

Use this directory as the file-only boundary between TDD stages.

Per story, create:

```text
.ai/state/tdd-handoff/<story-id>/
  agent1-tests/
  agent1-meta.json
  agent2-impl/
  agent2-escalations/
  agent2-results.json
  agent3-refactored/
  agent3-quality.json
  pipeline-status.json
```

Rules:
- Agent 1 writes tests and metadata only.
- Agent 2 reads tests from disk, writes implementation in the repo, and records results/escalations on disk.
- Agent 3 reads the repo plus stage artifacts, then records quality output on disk.
- No stage should rely on another stage's conversational history.
- Keep story ids filesystem-safe, e.g. `FG-TDD-001`.
