# AI Architecture Change Workflow

**Purpose**: Validate harness and orchestration wiring when `.ai/` guidance
changes.

## When To Run

Run this workflow only when the task changes any of:

- `.ai/**`
- `AGENTS.md`
- editor/agent rule files for this repo

If none of these files changed, skip this workflow.

## Step 1: Confirm Change Scope

Identify whether current changes touch AI-architecture files:

```bash
git diff --name-only
```

## Step 2: Verify Internal Consistency

Before finishing:

- re-read the changed `.ai` files
- confirm file references point at paths that actually exist in this repo
- confirm validation commands match `package.json`
- search for imported source-project residue:

```bash
rg -n '[s]hipyard|[r]efero|[l]angsmith|[r]ailway|[t]dd_handoff|generate-[d]esign-brief|ui-phase-[b]ridge|flight_[s]lot|git_finalize_[g]uard' .ai
```

The expected result is no matches unless a term is intentionally documented for
current-repo reasons.

## Step 3: Address Failures

If the audit fails:

1. fix missing or incorrect references
2. re-run the residue search
3. repeat until clean

## Step 4: Handoff Requirements

When this workflow is triggered, add an **AI Architecture Audit** section to
the completion gate with:

- changed architecture files
- residue-search result
- any workflow or command updates made

## Exit Criteria

- AI-architecture change scope confirmed
- harness references match the real repo
- imported source-project residue removed
