# CB-007 Task Breakdown

## Story

- Story ID: CB-007
- Story Title: Trace evidence quality and scriptable smoke inspection

## Execution Notes

- Keep this scoped to evidence quality and smoke scriptability, not the
  underlying product/runtime fixes discovered by the audit.
- Build on `CB-006`; do not replace or reopen its initial supported smoke-path
  work unless a direct conflict is found.
- Prefer checked-in helpers over ad hoc local shell scripts for repeated audit
  work.

## Story Pack Alignment

- Higher-level pack objectives: O2, O5
- Planned stories in this pack: CB-000 through CB-007
- Why this story set is cohesive: Pack 00 owns the observability and audit
  foundation that later rebuild stories depend on.
- Coverage check: this story mainly advances O5 with supporting O2 visibility.

## Tasks

| Task ID | Description | Dependency | Parallelizable | Validation |
|---|---|---|---|---|
| T001 | Capture failing probes for missing trace metadata/tags, insufficient scenario-family parity, and brittle scriptable smoke inspection. | must-have | no | focused failing tests or reproducible probes |
| T002 | Add a checked-in trace evidence contract so supported smoke/scenario runs carry family/runtime metadata and a traceable result shape. | blocked-by:T001 | no | helper/unit tests |
| T003 | Surface trace ids or explicit non-traceable outcomes through the supported manual-smoke path and add a stable scriptable inventory helper for the seed/preset corpus. | blocked-by:T001,T002 | no | dev-helper tests and smoke proof |
| T004 | Update the Pack 00 control docs and smoke ledger so the follow-on evidence-quality workflow is the new checked-in truth. | blocked-by:T002,T003 | yes | docs review |

Dependency values:
- `must-have`
- `blocked-by:<task-id list>`
- `optional`

Parallelizable values:
- `yes`
- `no`

## TDD Mapping

- T001 tests:
  - [ ] Real traces show missing metadata/tags or insufficient family labeling
  - [ ] Scriptable corpus inspection is reproducible without renderer-storage side effects
- T002 tests:
  - [ ] Supported trace runs include family/runtime evidence labels
- T003 tests:
  - [ ] Manual smoke helper or seed lab returns trace ids or explicit unsupported outcomes
  - [ ] Seed/preset inventory helper is stable and checked in
- T004 tests:
  - [ ] Control docs reflect the revised queue and evidence workflow

## Completion Criteria

- [ ] All must-have tasks complete
- [ ] Acceptance criteria mapped to completed tasks
- [ ] Tests added and passing for each implemented task
- [ ] Deferred tasks documented with rationale
