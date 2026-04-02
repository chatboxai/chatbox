# ChatBridge Technical Architecture

This document is the technical companion to [PRESEARCH.md](./PRESEARCH.md). It is presentation-friendly by design and focuses on the runtime, trust boundaries, state ownership model, and the critical lifecycle that makes third-party applications feel native inside chat.

## 1. Architecture Goals

ChatBridge needs to satisfy four architectural goals at the same time:

- Keep the chat experience continuous while apps appear, update, and complete inside the thread.
- Preserve TutorMeAI's trust model for K-12 through reviewed partners, scoped permissions, and teacher-governed access.
- Support different classes of apps, including no-auth, public external, and authenticated partner experiences.
- Stay Electron-first so the existing repo remains the main client shell rather than becoming a throwaway prototype.

## 2. System Overview

```mermaid
flowchart TD
    U["Student / Teacher"] --> EC["TutorMeAI Electron Client"]

    subgraph CLIENT["Electron Client"]
        EC --> CHAT["Chat UI + Streaming Renderer"]
        EC --> HOST["ChatBridge Host Runtime"]
        HOST --> ROUTER["Intent Router + App Orchestrator"]
        HOST --> EMBED["Embedded App Containers"]
        HOST --> CACHE["Local Cache / Offline Assist"]
        HOST --> SYNC["Sync + Reconciliation Manager"]
        HOST --> POLICYCACHE["Cached Policy + App Config"]
        EMBED --> NATIVE["Native Internal App Surface"]
        EMBED --> IFRAME["Sandboxed Partner Iframe Surface"]
    end

    subgraph PLATFORM["Platform Services"]
        ROUTER --> REG["Reviewed App Registry"]
        ROUTER --> AUTH["Auth Broker / Token Vault"]
        ROUTER --> PROXY["Partner Resource Proxy"]
        ROUTER --> TENANT["Tenant Policy Service"]
        ROUTER --> ORCH["LLM Orchestration Service"]
        ROUTER --> CONV["Conversation Store"]
        ROUTER --> APPSTATE["App Instance Store"]
        ROUTER --> AUDIT["Audit / Safety Log"]
        ROUTER --> OBS["Observability + Health"]
    end

    subgraph PARTNERS["Partner App Ecosystem"]
        IFRAME --> BRIDGE["Typed Bridge Protocol"]
        BRIDGE --> APPA["Chess App"]
        BRIDGE --> APPB["Drawing Kit"]
        BRIDGE --> APPC["Weather Dashboard"]
    end

    PROXY --> GDRIVE["Google Drive API"]
    ORCH --> MODEL["Primary Tool-Calling LLM Path"]
```

### Why this shape

- The Electron client stays in charge of the user experience.
- The host runtime becomes the policy and lifecycle brain of the app platform.
- Platform services own the parts that must be centralized: registry, policy, auth, persistence, auditability, and health.
- Partner apps remain isolated from both the raw desktop environment and the full conversation by default.
- Local cache exists for responsiveness, but the backend remains authoritative for durable state.

## 3. Trust Boundaries

```mermaid
flowchart TD
    subgraph TRUST1["Trusted Host Boundary"]
        USER["User Session"]
        CHAT["Chat UI"]
        HOST["Host Runtime"]
        USER --> CHAT --> HOST
    end

    subgraph TRUST2["Controlled Platform Boundary"]
        REG["Registry"]
        POLICY["Policy Engine"]
        TOKENS["Token Vault"]
        DB["Conversation + App State"]
        AUDIT["Audit Logs"]
    end

    subgraph TRUST3["Reviewed Partner Boundary"]
        APP["Partner App Runtime"]
        API["Partner Backend / APIs"]
    end

    HOST --> REG
    HOST --> POLICY
    HOST --> TOKENS
    HOST --> DB
    HOST --> AUDIT

    HOST -->|"scoped events + scoped context"| APP
    APP -->|"validated state / completion / auth requests"| HOST
    APP --> API
```

### Trust model

- The host is trusted to make routing, policy, and auth decisions.
- Platform services are trusted to persist and govern system state.
- Partner apps are reviewed, but still treated as less trusted than the host.
- Apps get scoped context and capabilities, not blanket access to the whole conversation or desktop runtime.

### Session binding rules

Bridge security should be tied to the app session, not just the app origin. Every app launch should create a `bridgeSession` with:

- `appInstanceId`
- expected origin
- protocol version
- launch-scoped opaque bridge token
- expiry timestamp
- capability list
- dedicated `MessagePort`
- monotonic message sequence

The host should send a signed bootstrap envelope plus a transferred `MessagePort`, require a nonce-based acknowledgment, and only accept subsequent messages on that bound port. Every state-changing event should also carry an idempotency key so replayed or duplicated events can be rejected safely.

## 4. Core Runtime Components

### Electron Client

- Renders the conversation UI
- Streams assistant responses
- Hosts native internal apps and sandboxed partner apps
- Maintains local caches for responsiveness
- Handles degraded-mode UX when network or app services fail

### ChatBridge Host Runtime

- Resolves app eligibility for the current user, tenant, teacher, and classroom
- Routes user intent to chat-only behavior or app-aware behavior
- Injects allowed tool schemas into the orchestration path
- Tracks active app instances and summaries
- Selects the latest active or recent normalized app summary before later-turn
  model calls and fails closed when the latest app state is stale or missing a
  safe summary
- Validates all bridge traffic
- Converts app outcomes into durable chat memory
- Normalizes partner outputs before they become model-visible summaries
- Reduces active app state into bounded host-owned reasoning context before the
  model sees any position-specific prompt supplement

### Platform Services

- Reviewed app registry
- Tenant and classroom policy engine
- User auth and partner auth broker
- Conversation and app-instance persistence
- Audit logging and safety events
- App health and invocation telemetry

### App Runtime

- Native React-hosted apps for internal surfaces
- Sandboxed iframe apps for reviewed partners
- Shared lifecycle contract no matter which rendering mode is used
- Chess now proves the native-hosted path by keeping a renderer-owned legal move
  engine behind the same host-owned app-part and reasoning-context contract
- The active flagship catalog is Chess, Drawing Kit, and Weather Dashboard.
  Debate Arena and Story Builder remain checked-in legacy reference
  implementations rather than active default-runtime targets.

### Sync and Reconciliation Manager

- Treats backend records as authoritative for conversations, app instances, and auth grants
- Tracks revision numbers or event offsets for durable objects
- Queues optimistic local actions with idempotency keys
- Replays only unacknowledged operations after reconnect
- Prevents stale local cache from overwriting committed server state

## 5. App Registration and Discovery

```mermaid
sequenceDiagram
    participant Dev as Partner Team
    participant Registry as Reviewed App Registry
    participant Policy as Tenant Policy Service
    participant Host as Host Runtime
    participant LLM as Orchestrator

    Dev->>Registry: Submit manifest + tool schemas + metadata
    Registry->>Registry: Review, validate, version, approve
    Policy->>Registry: Enable app for tenant / classroom
    Host->>Registry: Fetch approved app catalog
    Host->>Policy: Resolve teacher/classroom availability
    Host->>LLM: Inject only eligible tools for this context
```

### Registration principles

- Partner apps do not self-register live in production without review.
- Tool schemas are validated and normalized by the host before any model sees them.
- Availability is decided per context, not globally.
- App and host protocol versions must be checked before activation; mismatched versions should fail closed.

## 6. App Invocation Lifecycle

```mermaid
sequenceDiagram
    participant User
    participant Client as Electron Client
    participant Host as Host Runtime
    participant Registry as App Registry
    participant App as Partner App
    participant Store as Conversation + App State
    participant LLM as Orchestrator

    User->>Client: Ask for an app-backed action
    Client->>Host: Submit message
    Host->>Registry: Resolve eligible apps + tools
    Host->>LLM: Route with approved tools only
    LLM-->>Host: Select app tool / action
    Host->>Store: Create appInstance
    Host->>App: host.init + render app UI
    App-->>Host: app.ready
    Host-->>Client: Show embedded app in thread
    User->>App: Interact inside app
    App-->>Host: app.state
    User->>Client: Ask follow-up in chat
    Client->>Host: Follow-up question
    Host->>Store: Read active or recent host-owned app summary
    Host->>LLM: Answer with bounded app-aware context
    App-->>Host: app.complete
    Host->>Store: Persist summaryForModel + completion payload
    Host-->>Client: Resume natural chat flow
```

For the current Chess vertical slice, the "App" side of this sequence is a
native renderer component rather than an iframe partner. The important
architectural rule stays the same: the host-visible state is the bounded
`app.snapshot` payload, not opaque UI-local mutations.

### Key idea

The host, not the app, is responsible for translating app activity into conversational continuity.

### Tool execution semantics

The host should be the execution coordinator for app tools, even when the app owns the UI.

- All tool arguments are validated at invocation time against the reviewed schema version.
- Side-effecting invocations must carry idempotency keys.
- Retry behavior must be declared per tool as safe or unsafe.
- The host records normalized invocation payloads and results, not arbitrary raw partner blobs.
- Schema-version mismatches should fail closed with an explicit host error state rather than a best-effort execution attempt.

### Model-visible app context semantics

- App runtimes may emit detailed state, but the model only receives the
  host-owned subset that has been validated and normalized for the current
  turn.
- For Chess mid-game reasoning, the host reduces the board snapshot to bounded
  fields such as FEN, side to move, move count, status, and a short host note.
- If the latest board state is stale or cannot be validated, the host should
  inject an explicit degraded-state warning instead of pretending the assistant
  can still see the exact position.

## 7. Legacy Authentication Flow Reference for Story Builder

Story Builder is no longer part of the active flagship queue, but its
Google Drive auth flow remains the checked-in legacy reference for future
authenticated reviewed apps.

```mermaid
sequenceDiagram
    participant User
    participant Client as Electron Client
    participant Host as Host Runtime
    participant Auth as Auth Broker / Token Vault
    participant Proxy as Host Resource Proxy
    participant Google as Google OAuth / Drive
    participant Story as Story Builder App

    User->>Client: Open Story Builder
    Client->>Host: Start app session
    Host->>Story: host.init
    Story-->>Host: app.requestAuth(Google Drive)
    Host-->>Client: Prompt user to connect Google Drive
    User->>Client: Approve
    Client->>Auth: Begin OAuth flow
    Auth->>Google: OAuth exchange
    Google-->>Auth: Access + refresh tokens
    Auth->>Auth: Store encrypted credentials
    Auth-->>Host: Return scoped credential handle
    Host-->>Story: auth granted + scoped access
    Story->>Host: Request Drive action with credential handle
    Host->>Proxy: Authorize approved Drive operation
    Proxy->>Google: Perform Drive action
    Google-->>Proxy: Result
    Proxy-->>Host: Normalized response
    Host-->>Story: Approved result
```

### Auth design principles

- The host owns credentials.
- The app never receives raw long-lived refresh tokens.
- Auth is part of the app lifecycle, not a detached settings flow.
- Authenticated partner apps should reach protected resources through host-mediated resource calls or an equivalent approved backend proxy.

## 8. State Ownership Model

```mermaid
flowchart LR
    subgraph HOSTOWNED["Host-Owned State"]
        CONV["Conversation History"]
        ROUTE["Routing Context"]
        ACTIVE["Active App Pointer"]
        SUMMARY["Summary For Model"]
        POLICY["Allowed Apps + Permissions"]
        AUTH["Credential Handles"]
    end

    subgraph APPOWNED["App-Owned State"]
        UI["UI State"]
        DOMAIN["Domain Logic State"]
        LOCAL["Transient Local Draft / Cursor / Selection"]
    end

    subgraph PERSISTED["Persisted Platform Records"]
        MSG["Messages"]
        INST["App Instances"]
        EVT["App Events"]
        TOK["Auth Grants"]
        AUD["Audit Events"]
    end

    CONV --> MSG
    ACTIVE --> INST
    SUMMARY --> INST
    POLICY --> INST
    AUTH --> TOK
    UI --> EVT
    DOMAIN --> EVT
    HOSTOWNED --> PERSISTED
    APPOWNED -->|"validated updates"| HOSTOWNED
```

### Ownership rule

Apps can propose state updates, but the host decides what becomes durable platform truth.

### Consistency rules

- Backend records are authoritative once acknowledged.
- Local cache may render pending state, but not commit lifecycle transitions by itself.
- Every durable update should include a revision or event offset.
- Reconnect logic should replay only operations without a backend acknowledgment.

### Memory normalization

Apps should not write directly into `summaryForModel`. Instead, they should emit structured completion payloads and optional suggested summaries, and the host should validate, redact, and normalize that information before it becomes model-visible memory.

The shared completion contract lives in `src/shared/chatbridge/completion.ts` and is intentionally app-agnostic:

- `status`: `success`, `interrupted`, or `failure`
- `outcome`: machine-readable `code`, optional `label`, and optional structured `data`
- `resumability`: optional hint about whether the app believes the work is resumable, restartable, or terminal
- `suggestedSummary`: optional app-authored hint that the host may later redact or ignore
- `error`: required only for `failure`, carrying structured code/message/details instead of freeform prose

The host event stream should persist the structured completion payload itself and keep `summaryForModel` host-authored only. App-originated events may suggest summaries, but they must not populate model-visible memory directly.

Later-turn prompt assembly should read only the latest host-owned app record and
inject one of three states into the model path:

- active summary when the newest live app instance has a normalized summary
- recent summary when the newest relevant app instance is completed and
  normalized
- unavailable fallback when the newest app state is stale, errored, cancelled,
  or missing a safe summary

## 9. Data Model Snapshot

The platform should persist these first-class records:

- `conversations`
- `messages`
- `app_registrations`
- `app_versions`
- `app_instances`
- `app_events`
- `tool_invocations`
- `user_app_auth_grants`
- `tenant_app_policies`
- `audit_events`

This separation is important because governance, troubleshooting, and lifecycle recovery are all much harder if chat and app concerns are collapsed into a single record shape.

Records that can produce side effects or state transitions should also carry idempotency and ordering metadata so the platform can recover safely after retries or reconnects.

## 10. Policy Evaluation Path

```mermaid
flowchart TD
    Q["User asks for action"] --> E["Evaluate possible app routes"]
    E --> D["District guardrails"]
    D --> T["Teacher / classroom overrides"]
    T --> R["Reviewed app eligibility"]
    R --> C["Context relevance check"]
    C --> A{"One confident route?"}
    A -->|Yes| I["Invoke app-aware flow"]
    A -->|No, ambiguous| CL["Ask clarifying question"]
    A -->|No, unrelated| RF["Refuse app invocation"]
```

### Why this matters

Routing discipline is both a UX feature and a safety feature. A student should not be pushed into an app just because the model sees a vague opportunity.

### Policy precedence rules

- Reviewed registry status is a hard prerequisite for any app to be eligible.
- District-level denies are absolute and cannot be overridden below.
- Teacher and classroom controls may narrow, select, or disable from an approved set, but not enable an app outside district guardrails.
- When policy data is stale, the host should fail closed for new app activations and continue only already-authorized active sessions when safe.

## 11. Error Handling and Recovery

The host should treat these as explicit runtime states rather than generic failures:

- iframe load failure
- manifest mismatch
- invalid bridge event
- tool timeout
- auth denied
- expired partner credentials
- app crash
- completion payload missing

Recommended host responses:

- preserve the conversation,
- render a recoverable fallback surface,
- log the incident,
- and keep the chatbot able to explain what happened and what the user can do next.

## 12. Observability and Safety Operations

The architecture should make these events observable:

- app launch
- render success/failure
- tool invocation success/failure
- auth grant/revocation
- app completion
- policy refusal
- tenant disablement
- safety escalation

Operationally, the platform needs:

- per-app health dashboards,
- app-version kill switches,
- tenant-scoped disablement,
- and audit trails that help support and safety teams reconstruct what happened.

### Audit minimization rules

- Default logs should favor metadata, normalized payload shapes, and policy decisions over raw student content.
- Sensitive content should be redacted or hashed where possible.
- Exceptional forensic capture should be separately gated, explicitly time-bounded, and subject to retention policy.
- Auth logs should record grants, revocations, and resource classes accessed, not raw third-party credentials.

## 13. Presentation Talk Track

For a 3-5 minute architecture walkthrough, the simplest narrative is:

1. Start with the system overview diagram and explain the five layers.
2. Move to the trust-boundary diagram and explain why reviewed partner apps are still less trusted than the host.
3. Walk through the invocation lifecycle to show how chat stays aware of the app.
4. Show the legacy Story Builder auth sequence to explain how partner auth works without exposing credentials.
5. End on the state ownership model and say that this is the key design choice that keeps the experience coherent and safe.

## 14. Final Technical Position

ChatBridge should be implemented as an Electron-first host platform with:

- backend-supported governance and persistence,
- a reviewed partner registry,
- a typed bridge contract,
- host-owned memory and routing,
- sandboxed iframe support for partners,
- and explicit completion signaling as a first-class protocol event.

That architecture best fits the current repo, the K-12 trust model, and TutorMeAI's product strategy.
