# Pencil Reference Bundle

This folder holds the local Pencil documentation snapshot used by the Chatbox
AI harness.

## Why This Exists

Pencil work should not rely on memory or partial excerpts. Before using Pencil
for a story, sync the latest docs and review the relevant local references.

## Sync Command

Run this at the start of every Pencil story:

```bash
python3 .ai/scripts/sync_pencil_docs.py
```

This updates:

- `manifest.json`
- `routes.txt`
- `pages/**/index.md`

from the current `docs.pencil.dev` pages.

## Minimum Reading Set For Every Pencil Story

Read these local snapshots every time:

- `pages/getting-started/ai-integration/index.md`
- `pages/design-and-code/design-to-code/index.md`
- `pages/for-developers/the-pen-format/index.md`
- `pages/for-developers/pencil-cli/index.md`
- `ESSENTIALS.md`

Also read the story-relevant pages as needed:

- component or library work:
  `pages/core-concepts/components/index.md`,
  `pages/core-concepts/slots/index.md`,
  `pages/core-concepts/design-libraries/index.md`
- token work:
  `pages/core-concepts/variables/index.md`
- export/import workflows:
  `pages/core-concepts/import-and-export/index.md`
- editor behavior:
  `pages/core-concepts/pencil-interface/index.md`

## Files

- `ESSENTIALS.md`:
  condensed high-signal operational rules extracted from the synced docs
- `manifest.json`:
  sync timestamp and page inventory
- `pages/`:
  one extracted Markdown snapshot per docs page

## Policy

- Do not start a Pencil story from stale assumptions.
- If the sync fails, stop and surface the blocker.
- If the design system is still partial, label it honestly as `starter` or
  `working`, not `comprehensive`.
