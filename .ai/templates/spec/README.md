# Spec Template Pack

Use these templates to execute spec-driven development before implementation.

## Core Templates

- `CONSTITUTION_TEMPLATE.md`
- `FEATURE_SPEC_TEMPLATE.md`
- `TECHNICAL_PLAN_TEMPLATE.md`
- `TASK_BREAKDOWN_TEMPLATE.md`
- `INITIATIVE_BRIEF_TEMPLATE.md`
- `PRODUCT_DECISIONS_TEMPLATE.md`
- `STORY_MAP_TEMPLATE.md`
- `BRAINLIFT_TEMPLATE.md`
- `SOURCE_REGISTRY_TEMPLATE.md`
- `RESEARCH_VALIDATION_TEMPLATE.md`
- `UI_DESIGN_BRIEF_TEMPLATE.md`
- `UI_DESIGN_RESEARCH_TEMPLATE.md`
- `UI_DESIGN_DECISION_TEMPLATE.md`

## Legacy UI Template

- `PENCIL_VARIATION_REVIEW_TEMPLATE.md` for historical Pencil story packets only

## Recommended Story Artifact Layout

```text
docs/specs/<story-id>/
  constitution-check.md
  feature-spec.md
  technical-plan.md
  task-breakdown.md
  design-brief.md        # when UI scope exists
  design-research.md     # when UI scope exists
  design-decision.md     # when UI scope exists
```

## Recommended Initiative Artifact Layout

```text
docs/specs/<initiative-id>/
  initiative-brief.md
  brainlift.md
  source-registry.md
  research-validation.md
  product-decisions.md
  technical-plan.md
  story-map.md
  <story-id>/
    constitution-check.md
    feature-spec.md
    technical-plan.md
    task-breakdown.md
```
