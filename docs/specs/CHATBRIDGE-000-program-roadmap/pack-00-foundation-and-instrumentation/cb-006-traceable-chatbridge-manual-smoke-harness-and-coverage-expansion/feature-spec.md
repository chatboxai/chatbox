# CB-006 Feature Spec

## Metadata

- Story ID: CB-006
- Story Title: Traceable ChatBridge manual smoke harness and coverage expansion
- Author: Codex
- Date: 2026-04-02
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 00 - Foundation and Instrumentation

## Problem Statement

The smoke audit proved that LangSmith tracing exists, but only a subset of
ChatBridge scenarios actually emit traces and the web manual-smoke path emits
no LangSmith runs at all. That leaves too much of the real runtime invisible
when we are trying to diagnose end-to-end failures.

## Story Pack Objectives

- Higher-level pack goal: keep ChatBridge observable enough that later runtime,
  auth, and recovery stories can be debugged from evidence instead of guesswork.
- Pack primary objectives: O2, O5
- How this story contributes to the pack: it upgrades tracing from a partial
  contract seam into a reliable smoke-audit workflow that covers the real
  reviewed-app runtime.

## User Stories

- As a developer, I want manual ChatBridge smoke runs to emit traceable parent
  chains so I can diagnose which runtime seam failed.
- As a reviewer, I want scenario families to have explicit trace coverage so a
  green test suite still leaves observable evidence.

## Acceptance Criteria

- [x] AC-1: A supported manual ChatBridge smoke path emits LangSmith traces for
  flagship reviewed-app flows instead of relying on ad hoc local inspection.
- [x] AC-2: The trace matrix explicitly covers routing, reviewed-app launch,
  Story Builder auth/resource access, recovery, and persistence flows.
- [x] AC-3: The smoke audit workflow documents how to collect trace ids and map
  them back to findings without bespoke repo knowledge.

## Edge Cases

- Empty/null inputs: smoke tooling should fail clearly when the target runtime
  or project configuration is unavailable.
- Boundary values: repeated seeded-session runs must not overwrite trace
  evidence silently or leave ambiguous run names.
- Invalid/malformed data: trace sanitization must preserve diagnostics without
  leaking secrets or raw student data.
- External-service failures: missing LangSmith configuration, disabled desktop
  bridges, or unsupported web-only paths must degrade explicitly.

## Non-Functional Requirements

- Security: preserve existing LangSmith redaction and avoid logging raw
  credentials or sensitive student content.
- Performance: tracing additions must not materially degrade the supported
  manual smoke workflow.
- Observability: every required smoke family should leave a named trace or an
  explicit documented reason it cannot.
- Reliability: smoke documentation and helpers must be stable enough for repeat
  use during rebuild work.

## UI Requirements

- No new end-user product UI is required.
- Developer-facing smoke tooling may add narrow dev-only affordances if needed.

## Out of Scope

- Building a full production dashboard or alerting product on top of LangSmith
- Replacing Sentry or the existing vendor-neutral observability contract

## Done Definition

- The supported smoke workflow emits representative LangSmith traces for the
  rebuilt ChatBridge flows.
- The trace collection/documentation path is checked into the repo.
- Tests or smoke helpers cover the new tracing expectations.
- Validation passes for the touched scope.
