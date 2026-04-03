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
- **Date**: 2026-04-02
- **Context**: UI work needs earlier design clarity than a code-first workflow
  provides, but the Pencil approval gate adds manual pauses and tool-specific
  dependencies that are not required for most stories.
- **Decision**: Keep feature spec and technical planning in the normal story
  flow, then route visible UI through a design brief, repo-grounded and
  source-backed research when needed, 2 or 3 prompt-based directions, and an
  autonomous design decision record before implementation.
- **Alternatives Considered**: Keep Pencil as the default design lane; return to
  code-first exploration with no dedicated design artifacts.
- **Consequences**: UI stories no longer pause for default human design
  approval, story docs become the primary design evidence, and the design lane
  stays grounded in repo conventions plus explicit research.

- **ADR-ID**: ADR-0005
- **Date**: 2026-04-02
- **Context**: The active UI workflow should anchor itself in durable repo
  patterns instead of a tool-specific design library.
- **Decision**: Treat the existing codebase, shared tokens, and adjacent UI
  surfaces as the primary design-system foundation. Use design briefs and design
  decisions to extend that foundation intentionally.
- **Alternatives Considered**: Keep a `.pen` library as the canonical shared UI
  source of truth; let each story invent its own design language in prompts.
- **Consequences**: UI design work starts by inspecting current code patterns,
  and design docs must call out any intentional departures from those patterns.
