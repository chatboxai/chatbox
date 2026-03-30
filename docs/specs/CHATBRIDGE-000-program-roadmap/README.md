# ChatBridge Program Roadmap

This folder turns the ChatBridge presearch and architecture into an
implementation program for this repository.

Use it in this order:

1. Read `constitution-check.md` for planning constraints.
2. Read `feature-spec.md` for the program objective set and phase model.
3. Read `technical-plan.md` for the proposed module seams and data contracts.
4. Read `task-breakdown.md` for pack sequencing and dependency gates.
5. Open the next phase pack folder and work from the nested story packets.

## Required Strategy

This roadmap now follows the requested build order:

0. Foundation, deployment, integration setup, evals, tracing, and observability
1. Basic chat
2. App registration
3. Single-app tool invocation
4. UI embedding
5. Completion signaling
6. Context retention
7. Multiple apps
8. Auth flows
9. Error handling
10. Developer docs

Critical guidance carried into the pack structure:

- Start with the plugin interface right after basic chat is reliable.
- Build vertically and finish one app cleanly before adding breadth.
- Define the API contract early because later packs inherit it.
- Test the full lifecycle: invocation -> UI render -> interaction -> completion -> follow-up.
- Treat completion signaling as a first-class protocol concern.
- Think like a platform designer so third parties can understand the API.

## Objective Set

- O1. Keep the user experience continuous while apps open, update, and complete
  inside the thread.
- O2. Make the host, not the partner app, the owner of lifecycle, routing, and
  model-visible memory.
- O3. Preserve a K-12 trust model through reviewed partners, scoped context,
  policy enforcement, and auditable lifecycle events.
- O4. Support both unauthenticated and authenticated partner workflows without
  leaking long-lived credentials to app runtimes.
- O5. Ship a partner-ready platform, not a one-off demo, by ending with
  observability, safety controls, and developer tooling.

## Phase Packs

The `pack-*/` folders are canonical. The flat `PACK-*.md` files are summary
mirrors only.

0. [`pack-00-foundation-and-instrumentation/`](./pack-00-foundation-and-instrumentation/)
1. [`pack-01-reliable-chat-and-history/`](./pack-01-reliable-chat-and-history/)
2. [`pack-02-platform-contract-and-bridge-security/`](./pack-02-platform-contract-and-bridge-security/)
3. [`pack-03-chess-vertical-slice/`](./pack-03-chess-vertical-slice/)
4. [`pack-04-completion-and-app-memory/`](./pack-04-completion-and-app-memory/)
5. [`pack-05-multi-app-routing-and-debate-arena/`](./pack-05-multi-app-routing-and-debate-arena/)
6. [`pack-06-authenticated-apps-and-story-builder/`](./pack-06-authenticated-apps-and-story-builder/)
7. [`pack-07-policy-safety-and-partner-dx/`](./pack-07-policy-safety-and-partner-dx/)

## Priority Mapping

- Priority 0 foundation:
  [pack-00-foundation-and-instrumentation/](./pack-00-foundation-and-instrumentation/)
- Priority 1 basic chat:
  [pack-01-reliable-chat-and-history/](./pack-01-reliable-chat-and-history/)
- Priority 2 app registration:
  [CB-201](./pack-02-platform-contract-and-bridge-security/cb-201-reviewed-app-manifest-and-registry-contract/feature-spec.md)
  and
  [CB-202](./pack-02-platform-contract-and-bridge-security/cb-202-app-instance-and-event-domain-model/feature-spec.md)
- Priority 3 tool invocation:
  [CB-204](./pack-02-platform-contract-and-bridge-security/cb-204-host-coordinated-tool-execution-contract/feature-spec.md)
  and
  [CB-300](./pack-03-chess-vertical-slice/cb-300-single-app-tool-discovery-and-invocation/feature-spec.md)
- Priority 4 UI embedding:
  [CB-301](./pack-03-chess-vertical-slice/cb-301-in-thread-app-launch-and-rendering-flow/feature-spec.md)
  and
  [CB-302](./pack-03-chess-vertical-slice/cb-302-chess-runtime-and-legal-move-engine/feature-spec.md)
- Priority 5 completion signaling:
  [CB-304](./pack-03-chess-vertical-slice/cb-304-completion-resume-and-end-of-game-summary/feature-spec.md)
  and
  [CB-401](./pack-04-completion-and-app-memory/cb-401-structured-completion-payload-contract/feature-spec.md)
- Priority 6 context retention:
  [CB-402](./pack-04-completion-and-app-memory/cb-402-host-summary-normalization-pipeline/feature-spec.md)
  and
  [CB-403](./pack-04-completion-and-app-memory/cb-403-active-app-context-injection-for-later-turns/feature-spec.md)
- Priority 7 multiple apps:
  [pack-05-multi-app-routing-and-debate-arena/](./pack-05-multi-app-routing-and-debate-arena/)
- Priority 8 auth flows:
  [pack-06-authenticated-apps-and-story-builder/](./pack-06-authenticated-apps-and-story-builder/)
- Priority 9 error handling:
  [CB-404](./pack-04-completion-and-app-memory/cb-404-degraded-completion-and-recovery-ux/feature-spec.md)
  and
  [CB-705](./pack-07-policy-safety-and-partner-dx/cb-705-platform-wide-error-handling-and-recovery/feature-spec.md)
- Priority 10 developer docs:
  [CB-704](./pack-07-policy-safety-and-partner-dx/cb-704-partner-sdk-manifest-validator-and-local-harness/feature-spec.md)

## Working Rule

Each pack folder now contains the real per-story planning packets:

- `constitution-check.md`
- `feature-spec.md`
- `technical-plan.md`
- `task-breakdown.md`

For active implementation, work directly from that nested story packet or
promote it into a standalone `docs/specs/<story-id>/` folder if the story
graduates out of the roadmap. In either case, visible UI stories still require
the Pencil MCP review gate before UI code.
