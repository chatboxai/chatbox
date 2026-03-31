# Deployment Setup Workflow

**Purpose**: Configure deployment for the chosen stack and hosting provider
without assuming a default platform.

## Phase 0: Setup and Research

### Step 0.1: Run Preflight
- Run `agent-preflight`
- Deliver a concise preflight brief before deployment changes

### Step 0.2: Run Story Lookup
- Run `.ai/workflows/story-lookup.md`
- Gather provider-specific guidance for the selected platforms

### Step 0.3: Confirm the Real Baseline
- Verify the active deployment contract from repo docs and scripts instead of
  guessing from neighboring repos
- If the repo has no canonical deployment baseline yet, record that explicitly
- In this repo, the current checked-in web-shell baseline is `vercel.json` plus
  `pnpm build:web` outputting to `release/app/dist/renderer`

### Step 0.4: Verify Deployment Access Early
- Before promising a deploy, verify the required provider access is available
- If access is missing, record the blocker and continue with deploy-readiness
  work only

## Phase 1: Choose the Deployment Shape

### Step 1: Record Deployment Decisions
- production environments needed
- preview environments needed
- service topology
- build and start commands
- health checks
- rollback strategy

### Step 2: Record Provider Choices
- hosting provider
- data/service providers
- secrets/config management mechanism

## Phase 2: Configure the Chosen Provider

### Step 3: Add the Minimum Config
- Add only the provider config required by the selected path

### Step 4: Configure Secrets
- environment variables only
- no secrets committed to the repo
- keep examples or docs current when applicable

### Step 5: Validate the Deployment Path
- run the relevant repo validation commands
- verify runtime health or smoke path when possible

## Phase 3: Completion

### Step 6: Record Execution Status
- `deployed` with evidence
- `not deployed` with rationale
- `blocked` with the missing prerequisite

### Step 7: Completion Gate
- Run `.ai/workflows/story-handoff.md`
- Include chosen provider, environments, required secrets, health-check method,
  rollback plan, and explicit execution status

## Exit Criteria

- Deployment target and contract documented
- Config and secrets management are in place
- Execution status is explicit
