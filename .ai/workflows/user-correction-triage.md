# User Correction Triage Workflow

**Purpose**: Handle narrow user corrections proportionally instead of turning
every clarification into a new story or broad replanning cycle.

## When To Run

Run this workflow when the user gives a targeted correction such as:

- ignore one stale requirement
- rename or reword one item
- point out one mistaken assumption
- ask for a small directional correction to current work

Do not use this workflow when the user is materially changing scope,
architecture, or acceptance criteria.

## Step 1: Restate the Correction

Capture in one or two sentences:

- what the user corrected
- what is now out of scope or preferred
- what remains unchanged

## Step 2: Classify Blast Radius

Choose one level before editing:

- `L1: local correction`
- `L2: current-task contract correction`
- `L3: real scope or architecture change`

## Step 3: Apply the Smallest Valid Response

### If `L1`
- patch only the directly affected files
- do not broaden the task

### If `L2`
- patch the directly affected files and current-task artifacts
- keep the diff bounded to the active task

### If `L3`
- stop and re-route through the normal story gates

## Step 4: State Why You Did Not Escalate

In handoff or the next update, say:

- which blast-radius level you classified
- which files were updated
- why broader replanning was or was not needed

## Exit Criteria

- the correction was restated clearly
- blast radius was classified before editing
- only the minimum affected surfaces were changed for `L1` and `L2`
