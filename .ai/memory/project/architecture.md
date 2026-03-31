# Architecture Decisions (ADR Log)

Record durable workspace decisions here.

## Template

- **ADR-ID**:
- **Date**:
- **Context**:
- **Decision**:
- **Alternatives Considered**:
- **Consequences**:

## Seeded Decisions

- **ADR-ID**: ADR-0001
- **Date**: 2026-03-30
- **Context**: The workspace needs a reusable helper harness without mixing it
  into the runnable application surface.
- **Decision**: Keep helper workflow material in root `.ai/` and keep product
  implementation in the normal repo root directories.
- **Alternatives Considered**: No checked-in harness; placing product code
  under `.ai/`.
- **Consequences**: Repo-level docs must describe the boundary clearly, and
  `.ai/` must stay generic.

- **ADR-ID**: ADR-0002
- **Date**: 2026-03-30
- **Context**: The imported harness came from another repository with its own
  runtime, scripts, and memory history.
- **Decision**: Reset imported project memory and workflow assumptions so the
  harness starts as Chatbox-specific scaffolding rather than reused product
  history.
- **Alternatives Considered**: Keep the source repo state and rename files only.
- **Consequences**: The harness starts clean, but future changes must keep it
  aligned with Chatbox intentionally.

- **ADR-ID**: ADR-0003
- **Date**: 2026-03-30
- **Context**: The harness must advertise commands that actually exist in this
  repo.
- **Decision**: Standardize root-level validation around `pnpm test`,
  `pnpm check`, `pnpm lint`, `pnpm build`, and `git diff --check`.
- **Alternatives Considered**: Preserve source-repo commands and explain them
  ad hoc.
- **Consequences**: Workflow docs can be trusted, and repo guidance stays
  grounded in `package.json`.

- **ADR-ID**: ADR-0004
- **Date**: 2026-03-30
- **Context**: UI work needs earlier visual review and clearer user approval
  than a code-first workflow provides.
- **Decision**: Keep feature spec and technical planning in the normal story
  flow, then route visual exploration through Pencil with a shared
  `design-system.lib.pen` foundation, 2 or 3 variations, code-import grounding
  for existing UI, and an explicit approval gate before implementation.
- **Alternatives Considered**: Keep harness-owned design docs and templates as
  the main UI design layer; continue doing design exploration in code.
- **Consequences**: UI stories now pause for design approval, `.pen` artifacts
  become first-class story evidence, and the old internal design-doc layer is no
  longer the primary UI workflow.

- **ADR-ID**: ADR-0005
- **Date**: 2026-03-30
- **Context**: Early Pencil story work was too dependent on ad hoc geometry
  because the shared library was only a starter set.
- **Decision**: Treat `design/system/design-system.lib.pen` as a maintained
  first-pass comprehensive foundation aligned to Chatbox tokens and renderer
  patterns, covering shared primitives, forms, app chrome, content patterns,
  and layout shells.
- **Alternatives Considered**: Keep a minimal starter library and rebuild
  foundational components inside each story canvas.
- **Consequences**: Future UI stories should extend the shared library before
  adding one-off components, and review packets must call out any new gap rather
  than silently working around it.

- **ADR-ID**: ADR-0006
- **Date**: 2026-03-31
- **Context**: Phase 0 originally documented deployment assumptions without
  creating a real hosted surface or runnable release entrypoints.
- **Decision**: Standardize the current hosted web-shell baseline on the
  checked-in Vercel config (`vercel.json`) and keep desktop publishing rooted in
  `electron-builder.yml` plus the restored root `release-*.sh` wrappers.
- **Alternatives Considered**: Keep deployment as docs-only; invent a separate
  backend service deployment stack before the backend exists.
- **Consequences**: Phase 0 now has a real deployable host shell and smoke
  path, while future ChatBridge backend services remain explicit later-pack
  work.

- **ADR-ID**: ADR-0007
- **Date**: 2026-03-31
- **Context**: The hosted web shell had a manual Vercel production path, but
  merge completion stopped before any automatic post-merge deployment
  verification.
- **Decision**: Standardize `main` production sync on a checked-in GitHub
  Actions workflow (`.github/workflows/vercel-main-sync.yml`) backed by
  checked-in deploy and verify scripts, and disable Vercel Git auto-deploy for
  `main` so the repo-owned workflow is the single production source of truth.
- **Alternatives Considered**: Leave production deploy manual; rely on Vercel
  dashboard auto-deploys and undocumented post-merge checks.
- **Consequences**: Hosted-shell stories now have a post-merge Vercel CLI
  verification phase, and merge-to-`main` is no longer the last operational
  checkpoint for deployment-surface changes.
