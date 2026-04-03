# Pack 05 Status

- Pack state: validated baseline reopened by the smoke-audit rebuild queue and
  active catalog transition
- Current story: `CB-510` is validated and `CB-507` is the next queued item
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
| CB-506 | validated | Live reviewed invocation now consumes the reviewed route decision, can launch Drawing Kit from the default runtime path, and preserves natural Chess prompt handling plus explicit launch-failure evidence. |
| CB-507 | planned | Smoke-audit backfill to make clarify and refusal artifacts a live product surface instead of a test-only seam. |
| CB-508 | validated | Default reviewed catalog and seed inspection now point to Chess, Drawing Kit, and Weather while Debate Arena and Story Builder stay explicit legacy references. |
| CB-509 | validated | Drawing Kit now ships as the approved doodle-game flagship runtime with bounded checkpoints, traced follow-up/recovery proof, and a supported `drawing-kit-doodle-dare` seed/manual-smoke fixture. |
| CB-510 | validated | Weather Dashboard now launches through a host-owned weather boundary, supports traced refresh/degraded states, and ships a supported `weather-dashboard` seed/manual-smoke fixture. |

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

Historical Pack 05 proof remains checked in, but the reopened rebuild lane now
targets Chess, Drawing Kit, and Weather as the active flagship set. Eligibility
and invoke/clarify/refuse routing stay available as validated foundations, and
`CB-508`, `CB-506`, `CB-509`, and `CB-510` now make the active catalog,
natural-Chess fallback, default live invoke path, Drawing Kit runtime, and
Weather runtime explicit before the remaining clarify/refuse UI work continues
at `CB-507`.

## Smoke-Audit Reopen Notes

- `smoke-audit-master.md` reopened Pack 05 through findings SA-001, SA-002,
  SA-003, SA-008, SA-009, and SA-010.
- The active flagship catalog changed on 2026-04-02. Debate Arena and Story
  Builder are now legacy references, while Drawing Kit and Weather become the
  active replacement apps.
- `CB-508` closes the catalog/seed alignment layer of SA-008, SA-009, and
  SA-010 without claiming the later non-Chess launch/runtime stories are done.
- `CB-506` closes SA-002 by removing the live Chess-only invoke shortcut and
  proving explicit Drawing Kit launch, natural Chess fallback, and explicit
  launch-failure handling through the reviewed host-tool seam.
- `CB-509` closes the Drawing Kit portion of the later Pack 05 runtime gap by
  shipping the doodle-game runtime, bounded checkpoint contract, traced
  follow-up and recovery proof, and a supported active-flagship manual-smoke
  fixture.
- `CB-510` closes the Weather runtime/manual-smoke gap by shipping the
  host-owned weather boundary, dedicated inline dashboard surface, traced
  follow-up plus degraded proof, and a supported `weather-dashboard`
  desktop manual-smoke fixture.
- Historical Pack 05 proof remains checked in, but do not treat Pack 05 as
  live-runtime complete again until planned `CB-507` is implemented and
  validated.
