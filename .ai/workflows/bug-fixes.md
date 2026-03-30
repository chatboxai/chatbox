# Bug Fixes Workflow

**Purpose**: Manage and resolve bounded corrective work without drifting into
feature development or broad refactors.

## Phase 0: Intake and Scope

### Step 0.1: Run Preflight, Lookup, and Sizing
- Run `agent-preflight`
- Run `.ai/workflows/story-lookup.md`
- Run `.ai/workflows/story-sizing.md`

### Step 0.2: Create or Refresh the Batch Ledger
- Create or update `.ai/memory/session/bug-fix-batch.md`
- Record each bug with symptom, expected behavior, evidence, regression
  coverage, touched files, and status

### Step 0.3: Freeze Scope
- Only fix bugs listed in the active ledger
- New discoveries become a follow-up item unless they are required to complete
  the same correction safely

## Phase 1: Reproduce Per Bug

### Step 1: Write the Reproduction Contract
- Capture expected versus actual behavior for one bug at a time
- Prefer the narrowest reliable test surface
- If a test is not practical yet, record the exact manual reproduction

### Step 2: Prove RED
- Add or tighten a failing regression before implementation when practical
- Do not implement until the reproduction fails for the right reason

## Phase 2: Diagnose and Fix

### Step 3: Confirm Root Cause
- Trace the exact call flow and state transitions
- Avoid speculative fixes without file evidence

### Step 4: Define the Surgical Boundary
- Name the smallest file/module set that can safely fix the bug

### Step 5: Apply the Smallest Corrective Change
- Keep interfaces stable unless the bug itself is the contract defect

### Step 6: Verify Before Advancing
- Re-run the focused regression for the bug you just fixed
- Only then move to the next bug in the batch

## Phase 3: Batch Verification and Completion

### Step 7: Run Validation Gates
- Run the relevant repo validation commands
- Run any additional focused regression commands for the changed surfaces

### Step 8: Close the Batch Ledger
- Mark each bug as fixed, deferred, or blocked
- Record verification evidence for each entry
- Add concise notes to `.ai/memory/session/decisions-today.md`

### Step 9: Completion Gate
- Run `.ai/workflows/story-handoff.md`
- If `.ai/` changed, also run `.ai/workflows/ai-architecture-change.md`
- Use `.ai/workflows/git-finalization.md` only if the task includes git
  finalization

## Exit Criteria

- Every fixed bug has reproduction evidence and verification evidence
- Scope stayed corrective and bounded
- Required validation commands passed
