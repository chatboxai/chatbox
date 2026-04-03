# Trace-Driven Development Workflow

**Purpose**: Establish LangSmith-backed traces, scenario fixtures, and
observable lifecycle seams before or during orchestration-heavy work so
debugging and regression checks are grounded in real runtime evidence instead
of guesswork.

In this workspace, "trace-driven development" does **not** mean "sprinkle in a
few spans." It means the story defines the important behavioral scenarios,
makes them traceable as conversation threads or scenario runs in LangSmith, and
uses those traces as part of the proof that the feature actually works.

## When To Run

Run this workflow when a story changes:

- model orchestration
- routing or app selection
- tool discovery or execution
- embedded app lifecycle behavior
- completion signaling or app-aware memory
- partner auth or host-mediated resource access
- recovery/error handling where traces clarify boundary failures

Use this workflow for both product behavior and workflow/process work that
changes how orchestration-heavy stories are expected to prove correctness.

## Step 1: Define the Observable Boundary

Write down:

- the lifecycle states or decision points that matter
- the correlation IDs or instance IDs that tie the flow together
- the minimum signals needed to explain success and failure

Also decide:

- which user-visible conversations or scenario families must become LangSmith
  threads
- which metadata keys tie those runs together (`session_id`, `thread_id`,
  `conversation_id`, `message_id`, and any story-specific correlation IDs)
- which exact runs the engineer should expect to inspect when the story is done

## Step 2: Capture or Plan Baseline Traces

Before broad edits:

- identify the current or mocked end-to-end flow
- record which steps should emit traces or lifecycle events
- note what is currently invisible

If no representative traced path exists yet, define the smallest supported
route that can produce one. In this repo that usually means one of:

- a LangSmith-enabled integration scenario
- a checked-in manual smoke path that produces a named run
- both, when the story changes critical runtime behavior

## Step 3: Define the Eval Set

Create a focused eval list for:

- happy path
- expected user error
- malformed or invalid input
- timeout/crash/degraded path
- one follow-up or continuity path when applicable

Treat this as a required scenario matrix, not a suggestion. For most stories
the minimum matrix is:

1. happy path
2. expected user or operator error
3. malformed or invalid input
4. degraded/timeout/crash path
5. continuity or follow-up path

Also name which of these scenarios must leave inspectable LangSmith evidence.
If the runtime/test environment cannot emit live traces by default, the story
must still wire the scenario harness and capture at least one traced run in a
supported environment before completion.

## Step 4: Instrument Before Broad Logic Changes

Ensure the story has hooks for:

- lifecycle start/end
- routing or selection decisions
- tool invocation attempts and results
- auth or permission decisions
- completion and recovery outcomes

Keep instrumentation structured and avoid raw secret or unnecessary sensitive
content.

Instrumentation requirements:

- parent runs should map to user-visible conversations, scenario cases, or
  manual smoke sessions
- child runs should preserve the same thread metadata when they belong to the
  same conversation or scenario
- representative tests/manual smoke should produce stable run names and tags so
  engineers can actually find them later
- traces should be useful for edge cases, not just happy-path demos

## Step 5: Implement With a Trace Review Loop

As the story lands:

- inspect whether traces actually explain the path
- tighten naming and correlation if the flow is still opaque
- fix instrumentation gaps before declaring the story done

Review questions:

- can an engineer find the whole conversation or scenario as a LangSmith thread
  without guessing?
- do the important edge cases leave inspectable trace evidence, not only
  passing assertions?
- do child runs preserve the same thread metadata and correlation IDs as the
  parent run?
- can the trace alone explain why the feature passed, degraded, or failed?

## Step 6: Promote Stable Cases Into Regression Assets

After the flow is understandable:

- convert key trace scenarios into tests or eval fixtures
- document the expected signals in the story packet
- carry only durable insights into `.ai/memory/project/`

Required outputs for trace-driven stories:

- a named scenario matrix in the story packet or technical plan
- checked-in tests/fixtures/manual smoke steps for the representative cases
- LangSmith trace naming/tagging guidance that makes those cases discoverable
- completion-handoff notes that point to the exact traced scenarios or manual
  smoke routes used as proof

## Exit Criteria

- The critical path is traceable end to end.
- A focused scenario matrix exists for the important success and failure modes.
- Representative happy-path and edge/degraded behaviors are wired to produce
  inspectable LangSmith evidence.
- Instrumentation is good enough to support later debugging and regression work.
- The story handoff can name the exact traced scenarios, threads, or manual
  smoke runs engineers should inspect.
