# ChatBridge Full-Program Convergence Audit

This document is the Milestone 4 gate after Pack 07 exit. It does not replace
the pack structure. It closes the program by proving that the validated pack
artifacts compose into the product promised by the PRD.

## Entry Conditions

Do not start this audit until all of the following are true:

- Pack 04 exit memo is written
- Pack 05 exit memo is written
- Pack 06 exit memo is written
- Pack 07 exit memo is written
- `progress.md` shows Packs 04 through 07 as `validated`

## Audit Goal

Prove that Chess, Debate Arena, Story Builder, routing, host-owned memory,
auth, policy, recovery, and partner tooling all work together as one governed
product rather than as isolated completed stories.

## Representative Flow Set

### Flow 1: Chess continuity

Required proof:

1. natural-language launch into Chess
2. in-thread board render
3. legal move persistence
4. mid-game follow-up using host-owned board summary
5. explicit completion or resumable exit
6. later chat turn that still reasons over the validated Chess outcome

Primary existing evidence:

- `test/integration/chatbridge/scenarios/single-app-tool-discovery-and-invocation.test.ts`
- `test/integration/chatbridge/scenarios/chess-runtime-legal-move-engine.test.tsx`
- `test/integration/chatbridge/scenarios/mid-game-board-context.test.ts`

### Flow 2: Debate Arena routing and completion

Required proof:

1. route/clarify/refuse decision against a debate-style prompt
2. Debate Arena launch and lifecycle under the shared host contract
3. explicit completion into host-owned summary
4. follow-up turn that reflects the finished debate context

Primary existing evidence:

- `src/renderer/packages/chatbridge/router/decision.test.ts`
- `test/integration/chatbridge/scenarios/debate-arena-lifecycle.test.ts`
- `test/integration/chatbridge/scenarios/multi-app-continuity.test.ts`

### Flow 3: Story Builder authenticated continuity

Required proof:

1. host-owned auth boundary resolution
2. Drive-backed read or resume through the resource proxy
3. save/checkpoint continuity
4. completion handoff back into chat
5. later turn using host-approved Story Builder summary

Primary existing evidence:

- `test/integration/chatbridge/scenarios/auth-boundary-separation.test.ts`
- `test/integration/chatbridge/scenarios/resource-proxy-access.test.ts`
- `test/integration/chatbridge/scenarios/story-builder-lifecycle.test.ts`
- `test/integration/chatbridge/scenarios/active-app-context-injection.test.ts`

### Flow 4: Failure, denial, and recovery sweep

Required proof:

1. malformed bridge traffic rejection
2. timeout or runtime crash recovery
3. policy denial and kill-switch refusal
4. auth denial, expiry, or revoked handle behavior
5. partner validator and harness compatibility checks

Primary existing evidence:

- `test/integration/chatbridge/scenarios/bridge-session-security.test.ts`
- `test/integration/chatbridge/scenarios/policy-precedence-routing.test.ts`
- `test/integration/chatbridge/scenarios/operator-controls-rollout.test.ts`
- `src/shared/chatbridge/partner-validator.test.ts`
- `test/integration/chatbridge/scenarios/partner-sdk-harness.test.ts`

## O1-O5 Proof Matrix

| Objective | Convergence requirement | Existing pack proof | Remaining convergence proof |
|---|---|---|---|
| O1 continuous in-thread app UX | show all three flagship apps preserving thread continuity | Packs 03, 04, 05, 06 | one representative cross-app continuity sweep |
| O2 host-owned lifecycle, routing, and memory | show routing, completion, and later-turn memory all stay host-owned | Packs 02, 04, 05, 06 | one audit scenario linking launch -> completion -> follow-up across multiple apps |
| O3 reviewed-partner trust and governance | show policy, recovery, observability, and validator outputs all reinforce the reviewed model | Packs 02, 05, 07 | one denial/recovery/partner-DX sweep |
| O4 authenticated app support without raw credentials | show Story Builder auth and resource access stay host-mediated end to end | Pack 06 | one audit scenario that includes approval, save, resume, and expiry/denial behavior |
| O5 partner-ready governable platform | show Pack 07 governance plus the flagship apps behave as a coherent platform | Pack 07 | final linked objective memo in `progress.md` |

## Required Deliverables

- a convergence scenario plan under `test/integration/chatbridge/scenarios/`
- at least one representative convergence scenario that spans multiple packs
- an updated `progress.md` objective matrix with final proof links
- a short final program memo stating whether the current repo achieves the
  scoped PRD outcome or which backfill stories remain

## Working Rule

If this audit exposes a genuine prerequisite gap, do not patch around it inside
the convergence layer. Add a backfill story to the original pack that owns the
missing behavior, validate it there, then resume the audit.
