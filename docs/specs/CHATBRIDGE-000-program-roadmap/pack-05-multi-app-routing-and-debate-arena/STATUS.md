# Pack 05 Status

- Pack state: validated
- Current story: Pack 05 exit memo complete; next lane is Pack 06 -> CB-601
- Unlock rule: this pack opens only after Pack 4 has a written exit memo and
  linked proof in `progress.md`

## Story Order

1. CB-501
2. CB-502
3. CB-503
4. CB-504

## Story Ledger

| Story | State | Next requirement |
|---|---|---|
| CB-501 | validated | Reviewed-app eligibility is now explicit and router-facing with explainable exclusion reasons. |
| CB-502 | validated | Explicit invoke/clarify/refuse decisions now render through host-owned timeline artifacts. |
| CB-503 | validated | Debate Arena now runs inside the host shell with structured result and continuity proof. |
| CB-504 | validated | Multi-app continuity now keeps one primary active context plus one bounded recent-complete context without cross-instance bleed. |

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
