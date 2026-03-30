# Pack 05 - Multi-App Routing and Debate Arena

> Summary mirror only. Use the canonical folder:
> `pack-05-multi-app-routing-and-debate-arena/`

## Phase Fit

- Phase: 5 of 7
- Primary objectives: O1, O3
- Unlocks: reviewed-app eligibility resolution, clarify/refuse logic, second
  flagship app, multi-app conversation continuity

## Pack Goal

Move from "one app works" to "the platform can choose among multiple approved
apps safely and explainably," while proving a second structured educational
workflow through Debate Arena.

## Entry Gates

- Completion and app-aware memory are reliable enough to support more than one
  app in a conversation.
- Registry and manifest work already exist from pack 02.

## Stories

### CB-501 Reviewed app discovery and eligibility filtering

- Goal:
  resolve which apps are even candidates for the current tenant, teacher,
  classroom, and prompt context.
- Acceptance focus:
  only approved and context-relevant apps are exposed to orchestration.
- Likely surfaces:
  registry client,
  host runtime policy selectors,
  router inputs.

### CB-502 Route, clarify, or refuse decision path

- Goal:
  teach the host to pick one route, ask a clarifying question, or refuse app
  invocation when appropriate.
- Acceptance focus:
  ambiguous prompts do not force the user into the wrong app.
- Likely surfaces:
  orchestrator path selection,
  message-generation utilities,
  timeline clarifier and refusal rendering.
- UI note:
  visible UI story for clarifier/refusal states; route through Pencil before
  code.

### CB-503 Debate Arena flagship app

- Goal:
  prove a structured educational workflow with turn-based guidance,
  rubric-influenced support, and final performance summary.
- Acceptance focus:
  the platform can support more than game-state; it can support teacher-shaped
  learning flows too.
- Likely surfaces:
  new `src/renderer/components/chatbridge/apps/debate-arena/`,
  host runtime,
  completion normalization.
- UI note:
  visible UI story; route through Pencil before code.

### CB-504 Multi-app continuity in a single conversation

- Goal:
  support multiple app sessions over the life of one chat without losing current
  context or misattributing summaries.
- Acceptance focus:
  the user can move from one app-backed interaction to another safely.
- Likely surfaces:
  app instance selection,
  routing context,
  session history utilities,
  integration tests.

## Exit Criteria

- The host can choose among multiple reviewed apps with explainable logic.
- Debate Arena proves an educational workflow beyond Chess.
- The conversation remains coherent when more than one app exists over time.

## Risks

- Over-routing app suggestions for vague prompts
- Failing to distinguish active, recent, and completed app instances
- Adding a second flagship app before clarify/refuse behavior is disciplined
