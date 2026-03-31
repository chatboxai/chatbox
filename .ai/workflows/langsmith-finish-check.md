# LangSmith Finish Check Workflow

**Purpose**: Validate fresh live LangSmith evidence for ChatBridge stories whose
acceptance depends on traced runtime behavior, without pretending remote proof
exists when credentials or quota are unavailable.

---

## When To Run

Run this workflow when a ChatBridge story changes any of:

- routing or app selection
- tool discovery or host-managed tool execution
- embedded app lifecycle behavior
- completion signaling or app-aware memory
- auth brokerage or partner resource access
- recovery/error handling whose acceptance depends on fresh trace evidence

Skip this workflow for pure docs, static styling, or local-only refactors that
do not change traced runtime behavior.

---

## Step 1: Normalize LangSmith Env For The Shell

Chatbox accepts both `LANGCHAIN_*` and `LANGSMITH_*` aliases in the EDD helper,
but the `langsmith` CLI expects `LANGSMITH_*` names unless flags are passed.

Before running live verification, normalize the current shell:

```bash
export LANGCHAIN_TRACING_V2="${LANGCHAIN_TRACING_V2:-true}"
export LANGSMITH_TRACING="${LANGSMITH_TRACING:-$LANGCHAIN_TRACING_V2}"
export LANGSMITH_API_KEY="${LANGSMITH_API_KEY:-$LANGCHAIN_API_KEY}"
export LANGSMITH_PROJECT="${LANGSMITH_PROJECT:-${LANGCHAIN_PROJECT:-chatbox-chatbridge}}"
export LANGSMITH_ENDPOINT="${LANGSMITH_ENDPOINT:-$LANGCHAIN_ENDPOINT}"
export LANGSMITH_WORKSPACE_ID="${LANGSMITH_WORKSPACE_ID:-$LANGCHAIN_WORKSPACE_ID}"
export LANGSMITH_TEST_TRACKING="${LANGSMITH_TEST_TRACKING:-true}"
```

Required live-verification inputs:

- `LANGSMITH_TRACING=true`
- `LANGSMITH_TEST_TRACKING=true`
- a valid `LANGSMITH_API_KEY`
- a project name
- any product credentials required to drive the changed scenario

If live access is missing or the account is quota-capped, stop here and record
the finish check as blocked. Do not pretend live proof exists.

---

## Step 2: Produce Fresh Live Evidence

From the repo root, run the ChatBridge live EDD suite:

```bash
pnpm run test:chatbridge:edd:live
```

If the story changes only one scenario, you may scope the Vitest run further,
but the default expectation is that the ChatBridge EDD suite still stays green.

Record:

- the approximate start time
- the scenario IDs exercised
- whether the run completed cleanly or hit an external LangSmith limit

---

## Step 3: Inspect Recent Traces With The CLI

Use the global `langsmith` CLI available on the machine.

List recent traces:

```bash
langsmith trace list --project "$LANGSMITH_PROJECT" --last-n-minutes 30 --limit 5 --full
```

Inspect fresh runs:

```bash
langsmith run list --project "$LANGSMITH_PROJECT" --last-n-minutes 30 --limit 20 --full
```

Check:

- the expected ChatBridge scenario appears in the project
- run status matches the scenario that was exercised
- child runs expose the intended model, tool, lifecycle, or routing path
- errors, latency, and metadata look consistent with the story

---

## Step 4: Treat Environment Failures Honestly

Unexpected behavior includes:

- no fresh trace for the exercised scenario
- live uploads blocked by missing credentials
- live uploads blocked by LangSmith usage or quota limits
- trace status or child-run shape that does not match the expected story path

If the problem is product behavior, fix the code, rerun local validation, and
repeat this workflow.

If the problem is external access or quota, keep the local EDD evidence, mark
the live finish check blocked, and record the exact block reason in the story
handoff.

---

## Step 5: Record The Evidence In The Completion Gate

When this workflow ran, the completion gate must include an `EDD / LangSmith`
section covering:

- commands run
- scenarios exercised
- local proof artifact paths when relevant
- whether live LangSmith verification ran, passed, or was blocked
- trace IDs or URLs reviewed when available
- exact block reason when live verification could not be completed

---

## Exit Criteria

- Fresh local ChatBridge EDD evidence exists for the changed path.
- Live LangSmith verification either succeeded or was recorded as explicitly
  blocked with the precise external reason.
- The completion gate includes `EDD / LangSmith` evidence when this workflow
  ran.
