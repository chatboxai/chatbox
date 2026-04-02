# Pack 07 Status

- Pack state: in_progress
- Current story: CB-705
- Unlock rule: Pack 07 is active; keep the single-agent order and do not open later stories before the current one reaches `validated`

## Story Order

1. CB-701
2. CB-703
3. CB-705
4. CB-702
5. CB-704

## Story Ledger

| Story | State | Next requirement |
|---|---|---|
| CB-701 | validated | Policy precedence is explicit and fail-closed; proceed to privacy-aware audit. |
| CB-703 | validated | Privacy-aware audit events are now minimized by default with explicit forensic capture gating; proceed to platform-wide recovery. |
| CB-705 | planned | Start here next and build on the shared audit contract now in place. |
| CB-702 | planned | Start after CB-705 reaches `validated`. |
| CB-704 | planned | Start after CB-702 reaches `validated`. |

## Exit Checklist

- [x] CB-701 is at least `validated`
- [x] CB-703 is at least `validated`
- [ ] CB-705 is at least `validated`
- [ ] CB-702 is at least `validated`
- [ ] CB-704 is at least `validated`
- [ ] Policy precedence proof is linked
- [x] Privacy-aware audit proof is linked
- [ ] Recovery and failure-handling proof is linked
- [ ] Kill-switch and rollback proof is linked
- [ ] Validator and local harness proof is linked
- [ ] Pack-level exit memo is written below

## Exit Memo

Pending.

## Current Notes

- CB-701 is validated on this branch with:
  - shared policy contract: `src/shared/chatbridge/policy.ts`
  - eligibility integration: `src/shared/chatbridge/eligibility.ts`
  - export surface: `src/shared/chatbridge/index.ts`
  - happy-path proof: `test/integration/chatbridge/scenarios/policy-precedence-routing.test.ts`
  - failure proof: `src/shared/chatbridge/policy.test.ts`
- CB-703 is validated on this branch with:
  - shared audit contract: `src/shared/chatbridge/audit.ts`
  - shared export surface: `src/shared/chatbridge/index.ts`
  - auth-broker audit emission: `src/main/chatbridge/auth-broker/index.ts`
  - resource-proxy audit emission: `src/main/chatbridge/resource-proxy/index.ts`
  - shared resource audit contract: `src/shared/chatbridge/resource-proxy.ts`
  - happy-path proof: `test/integration/chatbridge/scenarios/privacy-aware-audit-operations.test.ts`
  - failure proof: `src/shared/chatbridge/audit.test.ts`
- `pnpm test`, `pnpm lint`, `pnpm build`, and `git diff --check` pass under Node 20.
- `pnpm check` remains blocked by existing upstream-wide type-contract drift outside the Pack 07 policy and audit surfaces.
