# Pack 06 Status

- Pack state: validated historical baseline with legacy-only follow-up parked
- Current story: no active work; `CB-605` stays parked unless Story Builder is
  restored to the active flagship catalog
- Unlock rule: Pack 5 exit proof is already present; continue strictly in Pack 6 story order

## Story Order

1. CB-601
2. CB-602
3. CB-604
4. CB-603
5. CB-605

## Story Ledger

| Story | State | Next requirement |
|---|---|---|
| CB-601 | validated | Auth boundary is explicit; proceed to credential-handle lifecycle. |
| CB-602 | validated | Credential handles are explicit; proceed to host-mediated resource proxy. |
| CB-604 | validated | Host-mediated resource access is now explicit and auditable; proceed to Story Builder. |
| CB-603 | validated | Story Builder is a validated historical baseline and now serves as a legacy reference after the flagship catalog change. |
| CB-605 | planned | Legacy-only backfill for Story Builder runtime auth/resource honesty if the app returns to the active catalog later. |

## Exit Checklist

- [x] CB-601 is at least `validated`
- [x] CB-602 is at least `validated`
- [x] CB-604 is at least `validated`
- [x] CB-603 is at least `validated`
- [x] Auth boundary proof is linked
- [x] Credential-handle lifecycle proof is linked
- [x] Host-mediated resource proxy proof is linked
- [x] Story Builder save and resume continuity is linked
- [x] Pack-level exit memo is written below

## Exit Memo

Pack 06 is validated. CB-603 closes the flagship authenticated-app proof by
putting Story Builder on the same host-owned auth broker, resource proxy,
save/resume continuity, and completion handoff path that the earlier Pack 6
foundations established. The renderer now exposes a typed Story Builder writing
surface inside the ChatBridge shell, seeded fixtures carry that contract
through local presets, and the story-level lifecycle scenario proves launch,
Drive read, save, completion handoff, and the expired-auth failure path. Pack 7
is unlocked.

## Smoke-Audit Reopen Notes

- `smoke-audit-master.md` reopened Pack 06 through finding SA-004.
- The active flagship catalog changed on 2026-04-02, so Story Builder is now a
  legacy reference app rather than an active rebuild target.
- Historical Pack 06 proof remains checked in, and `CB-605` stays available as
  a legacy reactivation packet if Story Builder returns to the active roadmap.

## Current Notes

- CB-601 is validated on this branch with:
  - shared boundary contract: `src/shared/chatbridge/auth.ts`
  - platform-auth naming split: `src/shared/request/request.ts`, `src/renderer/packages/remote.ts`, `src/renderer/stores/authInfoStore.ts`
  - happy path proof: `test/integration/chatbridge/scenarios/auth-boundary-separation.test.ts`
  - failure proof: `src/shared/chatbridge/auth.test.ts`
- CB-602 is validated on this branch with:
  - shared handle contract: `src/shared/chatbridge/auth.ts`
  - host-owned broker lifecycle: `src/main/chatbridge/auth-broker/index.ts`
  - happy path proof: `test/integration/chatbridge/scenarios/auth-broker-lifecycle.test.ts`
  - failure proof: `src/main/chatbridge/auth-broker/index.test.ts`
- CB-604 is validated on this branch with:
  - shared proxy contract: `src/shared/chatbridge/resource-proxy.ts`
  - host-owned resource proxy: `src/main/chatbridge/resource-proxy/index.ts`
  - happy path proof: `test/integration/chatbridge/scenarios/resource-proxy-access.test.ts`
  - failure proof: `src/main/chatbridge/resource-proxy/index.test.ts`
- CB-603 now has:
  - shared contract: `src/shared/chatbridge/story-builder.ts`
  - seeded continuity proof: `src/shared/chatbridge/live-seeds.ts`
  - renderer surface: `src/renderer/components/chatbridge/apps/story-builder/StoryBuilderPanel.tsx`
  - shell wiring: `src/renderer/components/chatbridge/apps/surface.tsx`, `src/renderer/components/chatbridge/chatbridge.ts`, `src/renderer/components/chatbridge/ChatBridgeMessagePart.tsx`
  - happy-path proof: `test/integration/chatbridge/scenarios/story-builder-lifecycle.test.ts`
  - continuity proof: `test/integration/chatbridge/scenarios/app-aware-persistence.test.ts`
  - renderer proof: `src/renderer/components/chatbridge/ChatBridgeMessagePart.test.tsx`
- `pnpm test`, `pnpm lint`, `pnpm build`, and `git diff --check` pass under Node 20.
- `pnpm check` remains blocked by existing upstream-wide type-contract drift outside Pack 6 surfaces.
