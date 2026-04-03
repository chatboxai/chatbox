# I001-01 Feature Spec

## Metadata

- Story ID: I001-01
- Story Title: Renderer execution governor entrypoint and reviewed-route adoption
- Author: Codex
- Date: 2026-04-02
- Related initiative:
  `docs/specs/CHATBRIDGE-001-post-rebuild-agent-productization/`

## Problem Statement

`CHATBRIDGE-001` phase `I001` calls for one clear execution-governor seam, but
the live runtime is still split across `stream-text.ts`, `single-app-tools.ts`,
and `reviewed-app-launch.ts`. The current behavior works, but `streamText`
still directly owns reviewed route decision plumbing, reviewed tool mounting,
trace event emission, and output normalization.

That makes the runtime harder to evolve into a real governor because the first
entrypoint is still an ad hoc bundle of local variables inside the model-call
path.

## Story Objectives

- Initiative goal:
  start `I001` by creating the first concrete execution-governor seam in the
  live renderer runtime.
- How this story contributes:
  it moves reviewed route preparation, reviewed tool mounting, trace event
  emission, tool wrapping, and output normalization behind one bounded runtime
  entrypoint that `streamText` delegates to.

## User Stories

- As a platform engineer, I want one renderer execution-governor seam to own
  reviewed route preparation and launch normalization so `streamText` stops
  hardcoding those details inline.
- As a user, I want the live reviewed app invoke, clarify, and refuse behavior
  to keep working while the runtime becomes easier to reason about.
- As a maintainer, I want the first `I001` slice to be small enough that it
  preserves the existing reviewed launch and bridge contracts instead of
  turning into a rewrite.

## Acceptance Criteria

- [ ] AC-1: A new execution-governor entrypoint exists for the live renderer
      path, and `streamText` delegates reviewed route preparation, tool
      wrapping, trace event emission, and output normalization through it.
- [ ] AC-2: The governor seam uses a shared ChatBridge contract for its route
      resolution and trace payload shape instead of bespoke `streamText`
      locals.
- [ ] AC-3: Reviewed invoke behavior still works through the new seam for an
      explicit active flagship launch and a natural Chess launch.
- [ ] AC-4: Clarify and refuse route artifacts still appear through the new
      seam with stable LangSmith event naming.
- [ ] AC-5: This story does not move app-record durability to backend truth and
      does not replace the bridge host controller lifecycle seam.

## Edge Cases

- Models without tool-use support must bypass reviewed route preparation while
  still receiving the wrapped tool set contract.
- Clarify and refuse outcomes must not accidentally mount reviewed tools.
- Invoke outcomes must not lose launch normalization or reviewed launch parts
  after the governor handoff.
- Trace event failures must stay non-fatal and must not collapse the chat turn.

## Non-Functional Requirements

- Observability:
  the governor must preserve the existing
  `chatbridge.routing.reviewed-app-decision` trace event contract.
- Reliability:
  the first governor slice must preserve current runtime behavior for invoke,
  clarify, and refuse paths.
- Maintainability:
  the new seam should reduce `streamText` ownership rather than adding another
  parallel runtime layer beside it.

## UI Requirements

- No new standalone UI surface is required.
- Existing reviewed launch parts and route artifacts remain the visible
  surfaces.

## Out of Scope

- Backend-authoritative app state and reconciliation
- Bridge host controller rewrites
- Operator/admin surfaces
- Policy/refusal layer changes beyond preserving current clarify/refuse behavior

## Done Definition

- The live renderer path has one explicit execution-governor entrypoint.
- `streamText` no longer assembles reviewed route behavior inline.
- The governor seam has shared contract types, focused unit coverage, and
  scenario proof.
- Validation passes for the touched scope.
