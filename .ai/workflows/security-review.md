# Security Review Workflow

**Purpose**: Perform repeatable security review before release and after
sensitive changes.

## Phase 0: Preflight and Routing

### Step 0.1: Run Preflight
- Run `agent-preflight`

### Step 0.2: Run Story Lookup
- Run `.ai/workflows/story-lookup.md`
- Gather local and official security guidance relevant to the touched surface

### Step 0.3: Identify the Attack Surface
- external inputs
- secrets and credentials handling
- data stores and external provider calls
- deployment/runtime configuration

## Phase 1: Review

### Step 1: Run Automated Checks
- run the repo-specific security and dependency checks that exist

### Step 2: Manual Checklist Pass
- input validation present and bounded
- error paths sanitized
- no secret leakage in logs or errors
- file/path handling safe
- retries/timeouts configured for external calls

## Phase 2: Abuse Testing

### Step 3: Negative Tests
- oversized payloads
- malformed requests
- path traversal attempts
- rate-limit and timeout handling

### Step 4: Dependency and Config Review
- env-only secret loading
- least privilege credentials
- production and local parity checked where relevant

## Phase 3: Remediation and Completion

### Step 5: Fix Findings by Severity
- critical or high before release
- medium with tracked debt if justified
- low documented with rationale

### Step 6: Document Outcome
- add the review summary to `.ai/memory/session/decisions-today.md`
- log durable decisions in `.ai/memory/project/architecture.md` when needed
- run `.ai/workflows/story-handoff.md`

## Exit Criteria

- no unresolved critical or high issues
- evidence recorded for auditability
