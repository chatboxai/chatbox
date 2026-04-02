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

| Objective | Convergence requirement | Existing pack proof | Convergence status | Representative evidence |
|---|---|---|---|---|
| O1 continuous in-thread app UX | show all three flagship apps preserving thread continuity | Packs 03, 04, 05, 06 | validated | `test/integration/chatbridge/scenarios/full-program-convergence.test.ts` plus the existing Chess, Debate Arena, and Story Builder lifecycle scenarios |
| O2 host-owned lifecycle, routing, and memory | show routing, completion, and later-turn memory all stay host-owned | Packs 02, 04, 05, 06 | validated | `test/integration/chatbridge/scenarios/full-program-convergence.test.ts` |
| O3 reviewed-partner trust and governance | show policy, recovery, observability, and validator outputs all reinforce the reviewed model | Packs 02, 05, 07 | validated | `test/integration/chatbridge/scenarios/full-program-convergence.test.ts` plus `operator-controls-rollout.test.ts` and `partner-sdk-harness.test.ts` |
| O4 authenticated app support without raw credentials | show Story Builder auth and resource access stay host-mediated end to end | Pack 06 | validated | `test/integration/chatbridge/scenarios/full-program-convergence.test.ts` plus `story-builder-lifecycle.test.ts` |
| O5 partner-ready governable platform | show Pack 07 governance plus the flagship apps behave as a coherent platform | Pack 07 | validated | `progress.md` final proof matrix and `test/integration/chatbridge/scenarios/full-program-convergence.test.ts` |

## Required Deliverables

- [x] a convergence scenario plan under `test/integration/chatbridge/scenarios/`
- [x] at least one representative convergence scenario that spans multiple packs
- [x] an updated `progress.md` objective matrix with final proof links
- [x] a short final program memo stating whether the current repo achieves the
  scoped PRD outcome or which backfill stories remain

## Implemented Convergence Evidence

The representative cross-pack proof now lives in:

- `test/integration/chatbridge/scenarios/full-program-convergence.test.ts`

That scenario intentionally composes:

1. reviewed-app routing across Chess, Debate Arena, and Story Builder
2. Chess mid-game reasoning grounded in host-owned board context
3. Debate Arena plus Story Builder later-turn continuity after compaction
4. Story Builder auth, Drive read/save, and completion handoff through the
   host-owned broker and resource proxy
5. policy denial, kill-switch posture, auth expiry, and partner harness replay
   rejection under the same host-owned recovery model

## Final Program Memo

As of April 1, 2026, this repo satisfies the scoped ChatBridge PRD outcome for
the reviewed-app platform defined by Packs 00 through 07.

The Pack 04 through Pack 07 proofs now compose into one governed product:

- Chess proves in-thread live runtime and bounded reasoning context.
- Debate Arena proves reviewed multi-app routing and structured completion.
- Story Builder proves host-owned auth, mediated resource access, save/resume,
  and completion handoff.
- Pack 07 proves policy, observability, recovery, and partner DX around those
  flagship apps.

This audit did not expose a missing prerequisite that requires a backfill
story. The remaining known repo issue is the unrelated inherited `pnpm check`
type drift outside ChatBridge; it does not change the scoped product verdict.

## Working Rule

If this audit exposes a genuine prerequisite gap, do not patch around it inside
the convergence layer. Add a backfill story to the original pack that owns the
missing behavior, validate it there, then resume the audit.
