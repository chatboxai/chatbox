# Pack 04 - Completion and App Memory

## Phase Fit

- Phase: 4 of 7
- Primary objectives: O1, O2, O3
- Unlocks: durable app-aware chat continuity, host-owned summary normalization, and degraded completion recovery

## Pack Goal

Turn app completion and model-visible memory into first-class host behavior so later app breadth does not rest on vague or app-authored summaries.

## Entry Gates

- Chess has proven a real app lifecycle and at least one concrete completion shape.
- The host/runtime contract from earlier packs is stable enough to normalize app outcomes centrally.

## Stories

- [CB-401 - Structured completion payload contract](./cb-401-structured-completion-payload-contract/feature-spec.md)
- [CB-402 - Host summary normalization pipeline](./cb-402-host-summary-normalization-pipeline/feature-spec.md)
- [CB-403 - Active app context injection for later turns](./cb-403-active-app-context-injection-for-later-turns/feature-spec.md)
- [CB-404 - Degraded completion and recovery UX](./cb-404-degraded-completion-and-recovery-ux/feature-spec.md)

## Exit Criteria

- Completion payloads are explicit and validated.
- Apps cannot write directly into model-visible memory.
- Degraded completion and recovery paths are represented in host behavior.

## Risks

- Letting partner-authored summaries bypass host validation.
- Treating completion as optional metadata instead of a lifecycle event.
- Ignoring degraded/incomplete app endings until they become production incidents.
