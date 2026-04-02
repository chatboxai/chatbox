# Pack 05 Status

- Pack state: validated baseline reopened by the smoke-audit rebuild queue
- Current story: pending backfill queue starting at `CB-505` after `CB-006`
  and `CB-305`
- Unlock rule: this pack opens only after Pack 4 has a written exit memo and
  linked proof in `progress.md`

## Story Order

1. CB-501
2. CB-502
3. CB-503
4. CB-504
5. CB-505
6. CB-506
7. CB-507

## Story Ledger

| Story | State | Next requirement |
|---|---|---|
| CB-501 | validated | Reviewed-app eligibility is now explicit and router-facing with explainable exclusion reasons. |
| CB-502 | validated | Explicit invoke/clarify/refuse decisions now render through host-owned timeline artifacts. |
| CB-503 | validated | Debate Arena now runs inside the host shell with structured result and continuity proof. |
| CB-504 | validated | Multi-app continuity now keeps one primary active context plus one bounded recent-complete context without cross-instance bleed. |
| CB-505 | planned | Smoke-audit backfill to restore default reviewed catalog parity for the scoped flagship apps. |
| CB-506 | planned | Smoke-audit backfill to replace the live Chess-only invocation shortcut with a real reviewed-app invoke path. |
| CB-507 | planned | Smoke-audit backfill to make clarify and refusal artifacts a live product surface instead of a test-only seam. |

## Exit Checklist

- [x] CB-501 is at least `validated`
- [x] CB-502 is at least `validated`
- [x] CB-503 is at least `validated`
- [x] CB-504 is at least `validated`
- [x] Explainable route selection is proven
- [x] Clarify or refusal behavior is linked to scenario proof
- [x] Debate Arena is validated end to end
- [x] Multi-app continuity proof is linked
- [x] Pack-level exit memo is written below

## Exit Memo

Pack 05 is validated.

Reviewed-app eligibility and invoke/clarify/refuse routing are now explicit,
Debate Arena runs as the second flagship app inside the host shell, and
compaction-time continuity now preserves one primary active app context plus
one bounded recent-complete context without treating every instance of the same
app as interchangeable. Pack 06 can open next.

## Smoke-Audit Reopen Notes

- `smoke-audit-master.md` reopened Pack 05 through findings SA-001, SA-002,
  and SA-003.
- Historical Pack 05 proof remains checked in, but do not treat Pack 05 as
  live-runtime complete again until `CB-505`, `CB-506`, and `CB-507` are
  implemented and validated.
