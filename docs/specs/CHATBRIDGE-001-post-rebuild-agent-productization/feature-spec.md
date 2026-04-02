# ChatBridge Post-Rebuild Agent Productization Feature Spec

## Metadata

- Story ID: CHATBRIDGE-001
- Story Title: Post-rebuild agent productization and Ghostfolio-parity initiative
- Author: Codex
- Date: 2026-04-02
- Related roadmap:
  `docs/specs/CHATBRIDGE-000-program-roadmap/progress.md`
- Related product intent:
  `chatbridge/PRESEARCH.md` and `chatbridge/ARCHITECTURE.md`

## Problem Statement

The active ChatBridge rebuild queue is fixing the live runtime so the product
actually behaves like the reviewed-app platform described in the roadmap.
That still does not fully match the stronger Ghostfolio-style agent
architecture. After the rebuild queue closes, ChatBridge will still need a
second initiative focused on control-plane maturity, durable state authority,
operator productization, and architecture truth sync.

This initiative is the explicit follow-on packet for that work. It is not a
replacement for the current rebuild queue. It starts only after the current
queue exits.

## Why This Initiative Exists

The Ghostfolio comparison showed that ChatBridge already has strong typed
contracts, bridge security, auth/resource primitives, structured UI, and
observability seams. The remaining gap is that those pieces are not yet unified
into one production-grade agent control plane.

Specifically, ChatBridge still needs:

- one live execution governor instead of scattered runtime seams
- backend-authoritative durable state and reconciliation
- operator-facing productization on top of traces, audit, and recovery signals
- architecture and product truth sync after the active catalog transition

The lower-priority layers should remain later in the initiative:

- policy and refusal control layer
- verification, confidence, and provenance layer
- high-risk action preview/confirm/execute workflow

## Initiative Objectives

- Objective 1: Unify live ChatBridge runtime control into one host-owned
  execution governor.
- Objective 2: Move durable app state, app events, and reconciliation toward
  backend-authoritative platform truth.
- Objective 3: Turn traces, audit events, and feedback into operator-facing
  product surfaces instead of raw implementation seams.
- Objective 4: Bring the checked-in architecture and flagship-app docs back
  into sync with the actual post-rebuild product direction.
- Objective 5: Defer policy/refusal, verification/confidence, and high-risk
  action workflow until the end of the initiative.

## User Stories

- As a user, I want app launches, chat follow-ups, and recovery behavior to
  come from one consistent host runtime so the product feels coherent rather
  than partially stitched together.
- As a platform engineer, I want one execution governor to own routing, launch,
  bridge lifecycle, tool execution, and recovery so behavior is observable and
  predictable.
- As an operator, I want runtime health, audit, and feedback information to be
  inspectable in product-facing admin flows so I can understand and manage app
  behavior without reading raw traces.
- As a maintainer, I want the checked-in presearch and architecture documents
  to match the active flagship set and real runtime model so the docs are safe
  to rely on again.
- As a later-phase platform owner, I want policy/refusal, confidence, and
  high-risk action handling to be layered on top of a stable core runtime
  rather than compensating for an unstable one.

## Scope

This initiative covers:

- a unified execution governor for live ChatBridge runtime
- backend-authoritative state and reconciliation design/implementation seams
- operator/admin/feedback productization on top of traces and audit signals
- checked-in architecture and flagship truth sync
- a later initiative phase for policy/refusal
- a later initiative phase for verification/confidence/provenance
- a final initiative phase for high-risk action workflow

This initiative does not cover:

- replacing the current rebuild queue
- reintroducing legacy Story Builder or Debate Arena as active flagship apps by
  default
- broad marketplace openness
- arbitrary partner write execution in early phases

## Acceptance Criteria

- [ ] AC-1: A post-rebuild initiative exists as a standalone packet that begins
      only after the current `CHATBRIDGE-000` rebuild queue completes.
- [ ] AC-2: The initiative prioritizes unified runtime governance,
      backend-authoritative state, operator productization, and architecture
      truth sync before policy/refusal and verification layers.
- [ ] AC-3: The packet explicitly defines the late ordering for:
      policy/refusal, verification/confidence/provenance, and high-risk action
      workflow.
- [ ] AC-4: The initiative references the real ChatBridge seams in
      `src/shared/chatbridge/`, `src/renderer/packages/chatbridge/`, and
      `src/main/chatbridge/`.
- [ ] AC-5: The initiative is framed as the path toward Ghostfolio-style agent
      maturity rather than as a vague cleanup list.

## Ordered Initiative Phases

1. Unified execution governor
2. Backend-authoritative app state and reconciliation
3. Operator/admin/feedback productization
4. Architecture and runtime truth sync
5. Policy and refusal layer
6. Verification, confidence, and provenance layer
7. High-risk action workflow

## Non-Functional Requirements

- Keep the current rebuild queue authoritative until it closes.
- Treat durable state authority as a platform concern, not a local renderer
  convenience concern.
- Preserve typed contracts and fail-closed behavior during control-plane
  consolidation.
- Keep the initiative compatible with the existing LangSmith and ChatBridge
  audit seams.

## Done Definition

- The initiative packet is written and checked in under `docs/specs/`.
- The active roadmap references it as the post-queue follow-on initiative.
- The phase order reflects the user-requested priority:
  control plane first, policy/verification/high-risk actions last.
