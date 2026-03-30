# Trace-Driven Development Workflow

**Purpose**: Establish traces, eval fixtures, and observable lifecycle seams
before or during orchestration-heavy work so debugging and regression checks are
grounded in runtime evidence instead of guesswork.

## When To Run

Run this workflow when a story changes:

- model orchestration
- routing or app selection
- tool discovery or execution
- embedded app lifecycle behavior
- completion signaling or app-aware memory
- partner auth or host-mediated resource access
- recovery/error handling where traces clarify boundary failures

## Step 1: Define the Observable Boundary

Write down:

- the lifecycle states or decision points that matter
- the correlation IDs or instance IDs that tie the flow together
- the minimum signals needed to explain success and failure

## Step 2: Capture or Plan Baseline Traces

Before broad edits:

- identify the current or mocked end-to-end flow
- record which steps should emit traces or lifecycle events
- note what is currently invisible

## Step 3: Define the Eval Set

Create a focused eval list for:

- happy path
- expected user error
- malformed or invalid input
- timeout/crash/degraded path
- one follow-up or continuity path when applicable

## Step 4: Instrument Before Broad Logic Changes

Ensure the story has hooks for:

- lifecycle start/end
- routing or selection decisions
- tool invocation attempts and results
- auth or permission decisions
- completion and recovery outcomes

Keep instrumentation structured and avoid raw secret or unnecessary sensitive
content.

## Step 5: Implement With a Trace Review Loop

As the story lands:

- inspect whether traces actually explain the path
- tighten naming and correlation if the flow is still opaque
- fix instrumentation gaps before declaring the story done

## Step 6: Promote Stable Cases Into Regression Assets

After the flow is understandable:

- convert key trace scenarios into tests or eval fixtures
- document the expected signals in the story packet
- carry only durable insights into `.ai/memory/project/`

## Exit Criteria

- The critical path is traceable end to end.
- A focused eval set exists for the important success and failure modes.
- Instrumentation is good enough to support later debugging and regression work.
