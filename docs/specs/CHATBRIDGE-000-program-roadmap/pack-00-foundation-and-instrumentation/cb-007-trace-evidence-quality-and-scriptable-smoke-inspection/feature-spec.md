# CB-007 Feature Spec

## Metadata

- Story ID: CB-007
- Story Title: Trace evidence quality and scriptable smoke inspection
- Author: Codex
- Date: 2026-04-02
- Related PRD/phase gate: `CHATBRIDGE-000` / Pack 00 - Foundation and Instrumentation

## Problem Statement

`CB-006` establishes a supported traceable smoke path, but the follow-on smoke
pass showed the evidence is still too weak for repeated rebuild work. Most
scenario families do not leave distinct top-level traces, the traces that do
land are missing useful metadata/tags, the seed-lab smoke path does not hand
the tester a trace id or support-state outcome, and scripted inspection of the
seed/preset corpus is more brittle than it should be.

## Story Pack Objectives

- Higher-level pack goal: keep ChatBridge observable enough that later runtime,
  routing, and recovery stories can be debugged from evidence instead of
  guesswork.
- Pack primary objectives: O2, O5
- How this story contributes to the pack: it upgrades Pack 00 from "some smoke
  traces exist" to "smoke evidence is distinct, inspectable, and scriptable
  enough to drive rebuild work."

## User Stories

- As a developer, I want smoke traces to carry scenario-family metadata and
  human-usable labels so repeated audit passes are comparable in LangSmith.
- As a reviewer, I want the supported manual smoke path to hand back a trace id
  or an explicit unsupported-state outcome so I know whether the run is usable.
- As a maintainer, I want to inspect the seeded and preset ChatBridge corpus
  from a scriptable helper without booting fragile renderer storage paths.

## Acceptance Criteria

- [ ] AC-1: Supported manual-smoke and scenario-trace runs emit named
  LangSmith traces with non-null metadata or tags that identify the scenario
  family, runtime target, and smoke support status.
- [ ] AC-2: The supported smoke workflow surfaces a trace id, run label, or
  explicit non-traceable reason back to the tester instead of requiring
  out-of-band CLI guessing.
- [ ] AC-3: There is a checked-in scriptable inspection seam for the current
  ChatBridge live-seed and preset-session corpus that does not depend on
  renderer-storage initialization side effects.

## Edge Cases

- Empty/null inputs: missing LangSmith config, disabled desktop bridge, or
  unsupported smoke targets must return explicit non-traceable outcomes.
- Boundary values: repeated smoke runs must not collapse into indistinguishable
  trace names or overwrite the prior run identity.
- Invalid/malformed data: trace metadata must stay sanitized and avoid raw
  student content or secret material.
- External-service failures: LangSmith or runtime failures should still leave a
  local smoke result that says why trace evidence is incomplete.

## Non-Functional Requirements

- Security: preserve existing LangSmith redaction and keep Pack 00
  vendor-neutral at the contract layer.
- Performance: evidence labeling and scriptable smoke helpers should stay dev-
  only and not materially slow the supported smoke path.
- Observability: each major scenario family should leave distinct top-level
  evidence or an explicit documented reason it does not.
- Reliability: the scriptable inspection path should be stable enough for
  repeated audit passes and CI-adjacent developer tooling.

## UI Requirements

- No new end-user product UI is required.
- Developer-facing dev-tool affordances are allowed if they remain narrow and
  scoped to the seed lab or smoke helpers.

## Out of Scope

- Building a production dashboard or alerting product on top of LangSmith
- Fixing the underlying product/runtime bugs discovered by the smoke audit
- Replacing the seed corpus or active reviewed-app catalog itself

## Done Definition

- The supported smoke path produces trace evidence that is labeled and usable
  enough for repeated audit passes.
- The seed lab or documented smoke helper returns trace ids or explicit support
  outcomes to the tester.
- A scriptable corpus-inspection seam exists for the ChatBridge seed/preset
  data.
- Validation passes for the touched scope.
