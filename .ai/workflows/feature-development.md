# Feature Development Workflow

**Purpose**: Implement a feature from scoped request to verified completion
without assuming a language, framework, or deployment stack beyond what the
repo already uses.

## Phase 0: Setup and Routing

### Step 0.1: Sync and Branch for the Story
- Run:
  - `git fetch --all --prune`
  - `git status -sb`
  - `git branch -vv`
- If this is a new story, create or switch to a fresh `codex/<short-task-name>`
  branch before any edits.
- If the current worktree already contains unrelated modifications, another
  active story, or other agents' in-progress work, do not pile the new story
  onto that tree. Create a clean worktree from the latest base branch and start
  the story there on a fresh `codex/<short-task-name>` branch.
- When that story starts in a fresh branch or worktree, copy the required local
  `.env*` files from the working `main` setup or previous story worktree before
  running project commands, and keep them untracked.
- If a story was started in a shared dirty tree anyway, move it into a clean
  worktree before finalization by replaying only the story-owned diff.
- Do not continue a new story on the previous story's branch.

### Step 0.2: Run Preflight
- Run `agent-preflight`
- Deliver a concise preflight brief before edits

### Step 0.3: Run Story Lookup
- Run `.ai/workflows/story-lookup.md`
- Gather local repo context plus any required official external guidance

### Step 0.4: Decide Whether Product Building Is Needed
If the request is still shaping a new product, a new vertical, or a significant
feature whose MVP, user journey, or architecture is not yet settled:
- run `.ai/workflows/product-building.md`
- produce the initiative packet before per-story implementation starts
- do not skip straight to coding from a vague initiative prompt

### Step 0.5: Decide Whether BrainLift Research Is Needed
If the story is broad, ambiguous, externally informed, or still needs a
defensible recommendation before the spec is locked:
- run `.ai/workflows/brainlift-research.md`
- produce a validated research brief or `brainlift.md`
- feed the decision summary back into the story packet before sizing or coding

### Step 0.6: Size the Story
- Run `.ai/workflows/story-sizing.md`
- Publish `lane: trivial` or `lane: standard`

### Step 0.7: Decide Whether Specs Are Needed
If the work is multi-file, contract-changing, or likely to branch in scope:
- use `.ai/skills/spec-driven-development.md`
- create the relevant artifacts under `docs/specs/<story-id>/`

### Step 0.8: Add Trace/Eval Readiness for Orchestration-Heavy Work
If the task changes model orchestration, routing, tool execution, app lifecycle,
completion, auth brokerage, or similar runtime coordination:
- run `.ai/workflows/trace-driven-development.md`
- define the LangSmith trace matrix, scenario set, and thread/correlation
  contract before broad implementation
- do not treat the story as trace-driven-complete until representative
  happy-path and edge/degraded scenarios are traceable through named runs

### Step 0.9: Run Autonomous UI Design for UI Stories
If the task changes visible UI and is not already implementing an existing
design decision:
- run `.ai/workflows/autonomous-ui-design.md`
- write or refresh `design-brief.md`
- gather repo-grounded design research and external sources when needed
- generate 2 or 3 prompt-based directions
- score them autonomously and record the chosen direction before code

### Step 0.10: Decide Whether TDD Is Needed
If the task changes behavior:
- run `.ai/workflows/tdd-pipeline.md`

## Phase 1: Clarify the Story

### Step 1: Confirm Scope
- goal and user outcome
- acceptance criteria
- edge cases and non-goals
- affected modules, services, or screens

### Step 2: Design the Smallest Viable Change
- reuse existing project patterns where possible
- keep boundaries explicit
- for UI scope, define concrete behavioral requirements in the spec and keep the
  visual exploration inside the design brief, research, and decision artifacts

## Phase 2: Implement

### Step 3: Write the Contract First
- for behavior changes, start with failing tests or a clearly documented manual
  reproduction if a test is temporarily impractical

### Step 4: Land the Smallest Working Change
- keep the change bounded to the accepted scope
- avoid mixing unrelated cleanup into the same task

### Step 5: Refactor Only After Green
- remove duplication and sharpen boundaries while keeping behavior stable

## Phase 3: Validate

### Step 6: Run Validation Gates
- run the relevant repo validation commands
- add focused smoke checks for the changed surface when needed

### Step 7: Update Docs and Memory
- update user-facing or architecture docs when the task changes them
- update `.ai` memory only when a durable repo truth changed
- for UI stories, record the design brief path, research scope, and chosen
  direction in the story docs when relevant
- refresh seeded visual examples in `src/renderer/packages/initial_data.ts` so
  local and production defaults reflect the current behavior; if unchanged,
  record `N/A` with a one-line reason in handoff

## Phase 4: Completion

### Step 8: Run the Completion Gate
- run `.ai/workflows/story-handoff.md`
- if `.ai/` changed, also run `.ai/workflows/ai-architecture-change.md`
- unless the user explicitly asks to pause or use a different merge path, run
  `.ai/workflows/git-finalization.md` after the completion gate

## Exit Criteria

- Acceptance criteria satisfied
- Validation passes
- Docs and memory match the landed behavior
- Combined completion gate delivered
- Story is merged to `main` on GitHub unless the user explicitly pauses or
  selects a different merge path
