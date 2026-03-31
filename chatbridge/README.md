# ChatBridge Brief

This folder captures the Week 7 ChatBridge case study and a working interpretation of what it means for this codebase.

Files:
- `README.md`: distilled product and engineering brief
- `BOOTSTRAP.md`: Pack 0 bootstrap, env, and setup contract
- `DEPLOYMENT.md`: Pack 0 deployment and infrastructure baseline
- `SERVICE_TOPOLOGY.md`: Pack 0 runtime, service, and deployment boundary map
- `INTEGRATION_HARNESS.md`: Pack 0 fixture and mock-harness strategy
- `EVALS_AND_OBSERVABILITY.md`: Pack 0 eval, trace, and observability baseline
- `ARCHITECTURE.md`: presentation-friendly target architecture
- `../docs/specs/CHATBRIDGE-000-program-roadmap/`: phased implementation packs

If the original assignment PDF is kept locally, treat it as a supplemental
reference rather than a required checked-in repo artifact.

## What The Project Is

ChatBridge is not "build a chatbot."

It is "turn Chatbox into a safe, extensible AI platform where third-party applications can live inside the conversation." The assistant should be able to discover an app's tools, invoke them with structured arguments, render the app's UI inside the chat experience, stay aware of the app's state, and continue the conversation naturally after the app finishes.

The required user experience is:

1. User asks for something that maps to an app.
2. The chat platform routes that request correctly.
3. The app appears inside the conversation UI.
4. The user interacts with the app without leaving chat.
5. The chatbot stays aware of what happened in the app.
6. The chatbot can discuss the result in later turns.

The canonical example is chess:

1. User says "let's play chess."
2. A chess board appears in chat.
3. The user makes moves on the board.
4. Mid-game, the user asks "what should I do here?"
5. The chatbot reasons over the current board state.
6. When the game ends, the conversation continues with retained context.

## Hard Requirements From The Spec

- Build on top of Chatbox.
- Support real-time AI chat with streaming responses.
- Preserve conversation history across sessions.
- Maintain context about active third-party apps and app state.
- Support multi-turn conversations that span app interactions.
- Handle app failures, timeouts, and errors gracefully.
- Add user authentication for the chat platform itself.
- Build a programmatic interface for third-party applications to:
  - register capabilities
  - define tool schemas
  - render custom UI
  - receive structured tool invocations
  - signal completion
  - manage their own state independently
- Ship at least 3 third-party apps.
- Chess is required.
- At least one third-party app must require authentication.

## What Graders Will Test

- Tool discovery and invocation from a natural-language request
- App UI rendering inside chat
- User interaction with the app, then completion signaling back to chat
- Follow-up questions after the app finishes, with context retention
- Multiple apps used in the same conversation
- Ambiguous requests routed to the correct app
- Refusal when a request should not invoke an app

## The Hard Parts

The spec emphasizes two core risks:

1. Trust and safety
- third-party code may be broken or malicious
- child safety matters because the case study is K-12 oriented
- apps must not leak student data or render unsafe content

2. Communication and state
- the platform must pass structured messages securely
- the platform must know app capabilities at runtime
- app UI state and chat state must stay coherent
- completion signaling must be explicit and reliable

The assignment explicitly warns that completion signaling is where many teams fail.

## What Chatbox Already Gives Us

This repo already solves several base-layer problems:

- Desktop shell and app lifecycle through Electron
- React renderer with routed screens and persistent local state
- Existing chat session model and message history
- Streaming generation pipeline
- Provider abstraction for many LLM vendors
- Existing tool-use patterns for knowledge base, files, web search, and MCP servers
- Existing auth/token storage patterns, even though they are currently Chatbox-AI specific

That means ChatBridge should not be approached as a greenfield app. The better framing is:

"Extend the current message-generation and tool-call pipeline so app tools and app UI become first-class chat artifacts."

## Likely Gaps To Fill In This Repo

Chatbox has useful primitives, but the assignment still requires platform work that does not appear complete yet:

- app registry and app manifest model
- third-party app lifecycle contract
- embedded app container UI inside the conversation timeline
- secure message bus between host chat and embedded app
- app session state persistence model
- explicit completion/result protocol
- platform-level user auth
- per-app auth flows for OAuth or API-key-backed apps
- safety review, sandboxing, and permission boundaries

## Strong Product Interpretation

The platform contract likely needs four layers:

1. Discovery
- app metadata
- app type
- auth requirements
- declared tools
- UI entrypoint

2. Invocation
- tool name
- JSON schema
- validated structured args
- invocation status

3. Embedded runtime
- sandboxed app surface
- host-to-app and app-to-host messaging
- app-local state
- permissions

4. Completion and memory
- app emits completion event
- app returns structured result
- chat stores a normalized summary of outcome/state
- later prompts can reference that summary

## Suggested Build Order

The spec's priority order is sound and matches this repo:

1. Get base chat running cleanly.
2. Define the app contract early.
3. Integrate one app end-to-end before adding more.
4. Solve completion signaling before polishing.
5. Add multi-app routing after one vertical slice works.
6. Add auth-heavy apps after unauthenticated apps are stable.

## Candidate App Mix

Minimum good portfolio:

- Chess
  - rich state
  - embedded UI
  - multi-turn assistant reasoning
- Weather or calculator-style utility
  - simpler public or no-auth tool flow
  - good for proving routing and result summarization
- Spotify, GitHub, or Google Calendar style app
  - authenticated integration
  - proves token handling and per-user authorization

## Practical Goal For This Repo

If we adapt Chatbox well, the end state should feel like:

"A local-first chat client whose assistant can call tools, open embedded mini-apps, track app state inside the conversation, and resume natural dialogue around those app interactions."

That is the actual target, not just adding a few buttons or launching iframes.

## Pack 0 Deployment Baseline

Phase 0 now treats deployment as real infrastructure work, not just planning:

- the web host shell is deployed through the checked-in `vercel.json` contract
- every merge to `main` now syncs the hosted shell to Vercel through the
  checked-in GitHub Actions workflow and verifies it with the Vercel CLI
- local smoke validation is `pnpm build:web`, `pnpm serve:web`, and
  `GET /healthz.json`
- desktop release entrypoints exist through the root `release-*.sh` wrappers
- future ChatBridge registry, policy, auth-broker, and app-instance services
  remain later-pack backend work and are still called out explicitly in the
  topology docs
