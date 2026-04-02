# Pack 05 Status

- Pack state: validated baseline reopened by the smoke-audit rebuild queue and
  active catalog transition
- Current story: pending backfill queue starting at `CB-508` after `CB-006`
  and `CB-305`
- Unlock rule: this pack opens only after Pack 4 has a written exit memo and
  linked proof in `progress.md`

## Active Rebuild Queue

Use this queue for implementation order inside the reopened Pack 05 rebuild
lane. Do not infer execution order from the historical story numbers.

1. `CB-508`
2. `CB-506`
3. `CB-509`
4. `CB-510`
5. `CB-507`

Legacy parked packets that are not part of the active queue:

- `CB-505`

## Historical Story Order

1. CB-501
2. CB-502
3. CB-503
4. CB-504
5. CB-505
6. CB-506
7. CB-507
8. CB-508
9. CB-509
10. CB-510

## Story Ledger

| Story | State | Next requirement |
|---|---|---|
| CB-501 | validated | Reviewed-app eligibility is now explicit and router-facing with explainable exclusion reasons. |
| CB-502 | validated | Explicit invoke/clarify/refuse decisions now render through host-owned timeline artifacts. |
| CB-503 | validated | Debate Arena is a validated historical baseline and now serves as a legacy reference after the flagship catalog change. |
| CB-504 | validated | Multi-app continuity remains a validated baseline, but it should be re-proven against the new active flagship set. |
| CB-505 | planned | Historical smoke-audit packet for restoring the old Debate Arena and Story Builder flagship catalog; now parked in favor of CB-508. |
| CB-506 | planned | Smoke-audit backfill to replace the live Chess-only invocation shortcut with a real reviewed-app invoke path. |
| CB-507 | planned | Smoke-audit backfill to make clarify and refusal artifacts a live product surface instead of a test-only seam. |
| CB-508 | planned | Transition the active flagship catalog to Chess, Drawing Kit, and Weather while retaining Debate Arena and Story Builder as legacy references. |
| CB-509 | planned | Build Drawing Kit as the new interactive no-auth flagship app. |
| CB-510 | planned | Build Weather Dashboard as the new data-backed no-auth flagship app. |

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
  SA-003, SA-008, SA-009, and SA-010.
- The active flagship catalog changed on 2026-04-02. Debate Arena and Story
  Builder are now legacy references, while Drawing Kit and Weather become the
  active replacement apps.
- Historical Pack 05 proof remains checked in, but do not treat Pack 05 as
  live-runtime complete again until `CB-508`, `CB-506`, `CB-509`, `CB-510`,
  and `CB-507` are implemented and validated.
