# Performance Optimization Workflow

**Purpose**: Improve latency or throughput using measured, reversible changes.

## Phase 0: Preflight and Baseline

### Step 0.1: Run Preflight
- Run `agent-preflight`

### Step 0.2: Run Story Lookup
- Run `.ai/workflows/story-lookup.md`
- Gather local and official performance guidance relevant to the path

### Step 0.3: Define the Metric and Budget
- choose the target metric
- set an acceptance threshold
- define what must not regress

### Step 0.4: Capture the Baseline
- measure before changes with representative workloads
- record the baseline in `.ai/memory/session/decisions-today.md`

## Phase 1: Profile and Hypothesize

### Step 1: Find Bottlenecks
- profile hotspots
- confirm whether the bottleneck is CPU, network, I/O, or rendering

### Step 2: Form an Optimization Hypothesis
- propose one change with expected impact and risk
- define the rollback trigger

## Phase 2: Implement Incrementally

### Step 3: Add a Guard Test When Stable
- add a benchmark or smoke test where the repo can support it reliably

### Step 4: Apply One Optimization at a Time
- keep changes measured and reversible
- do not mix unrelated cleanup into the optimization story

## Phase 3: Validate and Decide

### Step 5: Re-measure and Compare
- compare post-change metrics to baseline
- validate no correctness regression

### Step 6: Keep or Roll Back
- keep if gains are material and safe
- roll back if gains are marginal or regressions appear

## Phase 4: Completion

### Step 7: Run the Completion Gate
- run `.ai/workflows/story-handoff.md`
- include before/after numbers and rollback notes

## Exit Criteria

- metric target achieved or clearly characterized
- no correctness regression
- before/after evidence documented
