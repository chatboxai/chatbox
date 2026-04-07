# ChatBridge Design Interview

> Conducted 2026-04-02. Questions asked by Claude Code to fill gaps between SPEC.md/CODEBASE_ANALYSIS.md
> and actual implementation. Answers are verbatim from the session. Every decision in
> IMPLEMENTATION_PLAN.md traces back to a question here.

---

## Q1: Build Order

**Question:** Let's start with build sequence. The SPEC lists 10+ files to create and 5 to modify. What's your instinct on what to build first — do you start with the Express backend (auth, DB, WebSocket) so the frontend has something real to connect to, or do you wire up the ChatBridge plugin protocol in the Chatbox frontend first using mock/local data, then layer in the backend?

Options presented:
- Backend first: Auth → DB → WebSocket → REST endpoints, then connect frontend.
- Frontend first: ChatBridgeStore → controller → tool injection → iframe → Chess app, all against mock data.
- Vertical slice: Pick one end-to-end scenario and build the full stack for just that, then expand.

**Answer:** Vertical slice, but with a thin backend scaffold first. I can't do the vertical slice without a running Express server and WebSocket connection, so day 1 is the minimal backend: Express with one hardcoded user (skip real auth for now), a WebSocket endpoint that proxies to OpenAI and streams tokens back, and Prisma connected to Railway Postgres with just the messages table. No app registry, no OAuth, no REST CRUD yet — just enough that the Chatbox frontend can send a message and get a streamed response through the backend instead of calling OpenAI directly from the browser.

Once that pipe works, the vertical slice is: user says "let's play chess" → LLM returns tool_call over WebSocket → client forwards to chess iframe via postMessage → iframe returns tool_result → client sends result back to server → LLM generates final response. That's the full plugin lifecycle in one scenario. Everything else (auth, app registry, second and third apps, OAuth, error handling) layers on after that critical path works.

The reason I don't go pure frontend-first with mocks is that the WebSocket-to-postMessage handoff is the riskiest integration point — mocking it would just delay discovering the real problems. And I don't go full backend-first because I'd spend two days building CRUD endpoints before touching the plugin system, which is what I'm actually graded on.

**Decision:** Thin backend scaffold (day 1, using Anthropic Claude SDK) → vertical slice end-to-end → expand outward.

---

## Q2: WebSocket↔postMessage Handoff Mechanism

**Question:** The WebSocket→postMessage handoff is the core risk. Walk me through the exact client-side flow when the LLM returns a tool_call mid-stream. The server sends `{ type: 'tool_call', toolCallId, toolName, params }` over WebSocket — what happens next on the client? Specifically: does the client pause the stream and wait for the tool result before the server can continue, or does the server hold the OpenAI request open while the client does the round-trip to the iframe?

Options presented:
- Server holds OpenAI open: Server waits (Promise) for client to send back tool_result before feeding it to OpenAI and continuing.
- Client drives continuation: Server sends the full LLM response including tool_calls, closes that turn. Client does postMessage round-trip, then sends a new WebSocket message with the tool result, triggering a new OpenAI call.
- Haven't decided — need to think through it.

**Answer:** Client drives continuation. The server streams the full LLM response for one turn — if that response includes tool_calls, the server sends them to the client and that generation turn is done. The client receives the tool_call, forwards it to the iframe via postMessage, waits for tool_result (with a 10-second timeout), then sends a new WebSocket message back to the server with the tool result. The server feeds that result into the conversation history and makes a new OpenAI call for the next turn, which streams back normally.

This matches how OpenAI's function calling actually works — it's multi-turn, not mid-stream. The LLM emits a tool_call as a complete response, you add the tool result as the next message, then call the API again. It also matches how the existing Chatbox codebase handles tool use — AbstractAISDKModel.chat() in the AI SDK already runs a tool call loop where each tool call is a complete turn.

Holding the OpenAI connection open (option 1) doesn't really work because the streaming API completes when tool_calls are emitted — there's nothing to "hold open." You'd have to fight the SDK to do it that way.

**Decision:** Client drives continuation. Multi-turn protocol: server sends complete turn → client does iframe round-trip → client sends tool_result back → server makes next Anthropic Claude API call.

---

## Q3: Multi-Tool Synchronization

**Question:** OpenAI can return multiple tool_calls in a single response (e.g., start_game AND get_board_state in one turn). On the client, do you wait for ALL tool results before sending the continuation message to the server, or do you send each tool result as it comes back individually?

Options presented:
- Wait for all, then send batch: Client tracks in-flight tool calls. When all resolve (or timeout), sends one WebSocket message with all results.
- Send each result immediately: Client sends tool_result to server as each iframe round-trip completes. Server queues them.
- Serialize — only one tool call at a time: Process them sequentially, then send all results together.

**Answer:** Wait for all, then send batch.

**Decision:** Collect all tool results (or timeouts), send as a single batch to the server before triggering the continuation turn.

---

## Q4: iframe Placement

**Question:** Now the UI question. Where does the iframe render? The SPEC says apps render 'custom UI inside the chat' but doesn't nail down the layout. When the chess app is active, where does the board actually appear relative to the chat messages?

Options presented:
- Side panel: Chat stays full height on the left, iframe panel opens on the right.
- Inline in chat (below tool result): iframe appears as a block in the message thread.
- Bottom panel / drawer: A resizable panel slides up from the bottom.
- Haven't decided — open to recommendation.

**Answer:** Side panel, but reusing the pattern Chatbox already has. The Artifact.tsx component already renders a preview panel alongside the chat — it's the exact same layout concept. The chat stays on the left, the iframe opens in a right-side panel when an app is activated. The user sees both the conversation and the chess board at the same time, which is critical for the "what should I do here?" mid-game flow.

In the chat message thread itself, where the tool_call happened, I show a compact inline card — something like "[Chess — game in progress]" with a small status indicator — not the full iframe. That way if the user scrolls up through history, they see where app interactions happened, but the actual interactive UI is always in the side panel.

This is the lowest-risk approach because the Chatbox codebase already has the layout infrastructure for a side panel (Artifact preview uses it), so I'm not inventing a new layout system. I just need to swap the Artifact iframe for a ChatBridge iframe and add a toggle button in the toolbar.

For mobile or narrow viewports, the panel could overlay full-width or switch to a tab — but for the sprint I'm only targeting desktop widths.

**Decision:** Side panel (right of chat), reusing Artifact.tsx layout. Compact inline card in chat history at tool_call location. Desktop only for sprint.

---

## Q5: LLM Pipeline Split

**Question:** On the 'client-side Chatbox vs. server-side backend' split: the existing Chatbox makes LLM calls directly from the browser using the user's API key. Your backend adds server-side LLM calls. For the sprint, are you replacing Chatbox's existing LLM pipeline entirely (users only talk to your backend, not OpenAI directly), or running both in parallel (backend for ChatBridge sessions, existing Chatbox pipe for non-ChatBridge sessions)?

Options presented:
- Replace entirely — all LLM calls go through backend.
- Parallel — backend only for ChatBridge-enabled sessions.
- Backend is the only path — but thin wrapper.

**Answer:** Parallel — but let me be specific about the boundary. Chatbox's existing client-side LLM pipeline stays untouched for normal conversations. It already works — streaming, provider selection, context management, MCP tools, compaction — all of it. I'm not reimplementing or proxying any of that through the backend. That would be days of work for zero benefit.

The backend WebSocket path exists only for ChatBridge-enabled sessions — conversations where the user is interacting with third-party apps. When a user starts a ChatBridge session (or the LLM routes to a plugin tool), the frontend switches to the WebSocket pipeline. The backend handles LLM calls for these sessions because it needs to manage the tool-call round-trip: receive tool_call from OpenAI, send to client, receive tool_result back, feed it into the next OpenAI call.

For auth and persistent history: auth is a separate concern — the user logs in to the platform regardless of which LLM path they use. For history, ChatBridge sessions get persisted to Postgres via the backend. Normal Chatbox sessions keep using IndexedDB like they always have. The graders are testing the plugin system, not whether I migrated the entire Chatbox storage layer to Postgres.

The switch is at the session level, not the message level. Once a session is "ChatBridge-enabled" (meaning an app has been activated), all messages in that session go through the backend. This avoids mixing two storage systems within a single conversation.

**Decision:** Parallel pipelines. Chatbox client-side pipeline untouched. Backend WebSocket only for ChatBridge-enabled sessions. Switch at session level.

---

## Q6: Session Activation Trigger

**Question:** The ChatBridge session switch: what triggers it? How does the user or the LLM activate a ChatBridge session? Is it user-initiated ('open chess app' button), LLM-initiated (LLM decides to call a plugin tool), or automatically based on registered apps being available?

Options presented:
- User picks app explicitly: User sees app list and clicks one to open it.
- LLM routes automatically: All messages go through backend. LLM sees all registered app tools and decides.
- Hybrid — user opens app, LLM decides when to use tools.

**Answer:** Hybrid, but let me clarify the exact flow because it needs to handle the "let's play chess" test scenario naturally.

Every ChatBridge session starts with the LLM knowing what apps exist — a lightweight one-liner per app in the system prompt like "Available apps: Chess (interactive chess game), Weather (weather dashboard), Spotify (playlist creator)." No tool schemas yet, just names and descriptions. This costs almost nothing in tokens.

When the user says "let's play chess," the LLM doesn't need a tool call to respond — it recognizes the intent and the backend activates the chess app. At that point, the chess app's full tool schemas get injected into subsequent LLM calls, the iframe opens in the side panel, and the LLM makes the start_game tool call. The user can also explicitly click an app from a toolbar or app list to activate it — same result.

Once an app is active, its tools stay in the LLM context until the app signals completion or the user closes it. If the user says "what's the weather like" while chess is active, the LLM sees both chess and weather tools — but weather's schemas only get injected when the LLM or user activates it.

This handles all the testing scenarios: scenario 1 (user asks to use an app — natural language works), scenario 6 (ambiguous query — LLM sees the app list and picks the right one), and scenario 7 (unrelated query — LLM sees no matching app in the list and doesn't invoke anything). It also keeps token costs down because full schemas are only present for active apps, not all registered apps.

The session switches to WebSocket mode on the first app activation, not before. If someone just chats without mentioning any app, they stay on the normal Chatbox pipeline.

**Decision:** Hybrid. App list summary always in system prompt (no schemas, just names + descriptions). Full schemas injected only for active apps. Session switches to WebSocket on first app activation.

---

## Q7: App Activation Mechanism

**Question:** When the LLM 'recognizes the intent and the backend activates the chess app' — what is the actual mechanism? The LLM can't just decide to activate an app without a concrete signal. How does the backend know to activate chess and inject its tool schemas?

Options presented:
- activate_app tool call: All sessions start with one special tool `activate_app(appName)`. LLM calls it when it recognizes intent.
- Text parsing / heuristic: Backend inspects LLM text responses for app names. Fragile.
- User intent is always a tool call: LLM is instructed that to use an app, its first action MUST be a tool call.

**Answer:** activate_app tool call. Every ChatBridge session starts with one meta-tool in scope: `activate_app({ appName: string })`. The system prompt lists available apps by name and description. When the user says "let's play chess," the LLM calls `activate_app({ appName: "chess" })`. The backend receives this, looks up chess in the app registry, and the tool result returns the app's description plus confirmation it's activated. On the client side, receiving the activate_app tool call triggers the iframe to open and the app's full tool schemas to be injected into subsequent LLM calls. The LLM's next turn now sees start_game, make_move, get_board_state and naturally calls start_game.

This is one lightweight tool (tiny schema) always in scope, instead of all app schemas always in scope. It's deterministic — no text parsing. And it doubles as the session switch trigger: the first activate_app call is what flips the session to WebSocket mode and opens the side panel.

**Decision:** `activate_app({ appName })` is the single meta-tool always in scope. Deterministic, tiny schema. Doubles as the session mode switch trigger.

---

## Q8: Chess Board Library

**Question:** Chess app implementation: which board rendering library are you using, and have you used it before? The choice matters for how the board sends move events back to the protocol.

Options presented:
- react-chessboard: React component, declarative FEN-based API, onPieceDrop callback.
- chessboard.js (jQuery-based): Older, vanilla JS, well-documented.
- Custom SVG/canvas: Full control, no dependency. High implementation cost.
- Haven't chosen yet.

**Answer:** react-chessboard.

**Decision:** react-chessboard + chess.js for the chess app.

---

## Q9: Chess UI Move Handling

**Question:** In the chess app, when a user drags a piece on the board (direct UI interaction without the LLM), what exactly happens? Does the move get validated immediately in the iframe (via chess.js), and then the iframe sends state_update with the new FEN? Or does the user's move also go through a make_move tool call to the LLM?

Options presented:
- Direct: validate in iframe, send state_update: chess.js validates → board updates → state_update sent. LLM NOT involved.
- All moves go through LLM: Adds latency to every move. Not suitable for interactive gameplay.
- Depends on whether LLM initiated the session.

**Answer:** Direct: validate in iframe, send state_update.

**Decision:** User piece drags are handled entirely in the iframe (chess.js validates, board updates, `state_update` sent). LLM is only invoked when user explicitly asks for analysis or makes a request in the chat.

---

## Q10: Demo App Selection

**Question:** The two non-chess demo apps. The SPEC mentions Weather Dashboard and Spotify Playlist, but I want to confirm: are those your final choices, and do you know what specific integration challenge each one demonstrates that chess doesn't?

Options presented:
- Yes — Weather and Spotify as specced.
- Weather yes, but replacing Spotify.
- Still deciding on the third app.

**Answer:** Weather and Spotify, but I want to be honest about the risk. The assignment requires auth for at least one third-party app — "Auth is required for at least one third-party application" — so I can't dodge OAuth entirely. Spotify is the right choice because the API is well-documented, the OAuth flow is standard authorization code grant, and creating a playlist is a concrete visible result that's satisfying to demo.

But Spotify OAuth is the thing I build last, not second. The priority order is: Chess first (highest complexity, proves the full plugin lifecycle), Weather second (proves a second app works, tests tool routing between multiple apps, fast to build since it's just a fetch to a weather API), Spotify third (proves OAuth flow). If I run out of time, I'd rather have rock-solid Chess + Weather with a half-working Spotify than three apps that are all buggy.

What each demonstrates that the others don't: Chess = complex ongoing state, bidirectional communication, mid-session AI analysis. Weather = stateless tool calls, external API with server-side key, simple UI rendering, no user auth. Spotify = full OAuth2 popup flow, token storage in Postgres, token refresh, user-specific data. Three completely different integration patterns — that's the point.

**Decision:** Chess → Weather → Spotify build order. Spotify is build-last; Chess + Weather alone satisfy grading if time runs short.

---

## Q11: OAuth Token Path (Popup → iframe)

**Question:** The OAuth popup flow has one tricky step: after the user approves in the Spotify popup, the callback page needs to notify the parent window, which then needs to notify the chess/weather iframe. But the callback page and the iframe are different origins. Walk me through exactly how the token gets from the callback page to the iframe that needs it.

Options presented:
- Callback → parent → iframe (two hops): Callback calls `window.opener.postMessage`. Parent forwards token to iframe.
- Iframe polls the backend: Iframe polls GET /api/oauth/spotify/status every second.
- Backend pushes token via WebSocket: Backend sends `auth_token` to the user's WS connection when callback stores the token.

**Answer:** Option 1 for the notification, but the actual token never passes through the browser at all. Here's the exact sequence:

1. User clicks "Connect Spotify" in the chat → parent opens `window.open('/api/oauth/spotify/authorize')`
2. User approves on Spotify → Spotify redirects to `/api/oauth/spotify/callback`
3. Backend exchanges auth code for tokens, stores access + refresh tokens in `oauth_tokens` table keyed to `user_id + provider`
4. Callback page renders a tiny HTML snippet that calls `window.opener.postMessage({ type: 'oauth_complete', provider: 'spotify' }, CLIENT_URL)` and then `window.close()`
5. Parent window receives this, updates chatBridgeStore to mark Spotify as authenticated
6. Parent sends `{ type: 'auth_ready', provider: 'spotify' }` to the Spotify iframe — just a signal, no token

The key insight: Spotify API calls don't happen in the iframe. When the LLM calls `create_playlist`, the tool execution happens on the backend — the backend reads the stored OAuth token from Postgres and makes the Spotify API call server-side. The `tool_result` sent back to the iframe is just the playlist data for display. The token never touches the browser.

This is more secure (tokens stay server-side), simpler (no token forwarding through postMessage), and handles token refresh transparently (backend checks expiry before each call). The iframe is purely a UI layer for Spotify — it shows playlists, lets the user pick songs, but all authenticated API calls go through the backend.

If for some reason an app genuinely needs the token client-side (e.g., a direct WebSocket to a third-party service), the parent can fetch it from `GET /api/oauth/spotify/token` and forward via postMessage. But that's the escape hatch, not the default path.

**Decision:** Token NEVER leaves the server. Callback → `window.opener.postMessage({type:'oauth_complete'})` → parent → iframe gets `{type:'auth_ready'}` signal only. All Spotify API calls made server-side using stored Postgres token.

---

## Q12: Railway Deployment Topology

**Question:** Railway deployment topology. How many Railway services are you planning, and how does the Chatbox frontend (a Vite SPA) find the backend URL at runtime?

Options presented:
- 3 services: backend + DB + static frontend.
- 2 services + DB, apps bundled into backend: Backend serves Vite SPA + all demo apps. One domain.
- 5+ services: each app separate.

**Answer:** Option 2 — one backend service + Postgres addon. The Express server serves everything: the Vite SPA build (`dist/`) at the root, demo apps as static files under `/apps/chess/`, `/apps/weather/`, `/apps/spotify/`, REST API under `/api/`, and the WebSocket upgrade on `/ws`. One domain, one port, one Railway service, one deploy.

This eliminates CORS entirely — the frontend, backend, and demo apps are all the same origin. No `Access-Control-Allow-Origin` headers to configure, no preflight requests, no "it works locally but not in prod" CORS debugging. The WebSocket connection is just `wss://${window.location.host}/ws` — no environment variable needed for the backend URL.

For the frontend to find the backend: it doesn't need to. Same origin means `fetch('/api/conversations')` and `new WebSocket('wss://' + location.host + '/ws')` just work. No `VITE_API_URL` env var, no build-time injection, no runtime config.

The Express server setup is roughly:
```javascript
app.use('/api', apiRoutes)
app.use('/apps/chess', express.static('apps/chess/dist'))
app.use('/apps/weather', express.static('apps/weather/dist'))
app.use('/apps/spotify', express.static('apps/spotify/dist'))
app.use(express.static('dist'))  // Vite SPA fallback
```

The demo apps are still architecturally separate — they're built independently, loaded in iframes, communicate via postMessage. They just happen to be served from the same Express process. A real third-party developer would host their app anywhere and register their URL. The iframe boundary is the isolation, not the hosting.

For the sprint, this is the right call. One `railway up` deploys everything. If I needed to split later, I'd move each app to its own service and update the registered URLs — no code changes to the plugin protocol.

**Decision:** One Railway service + Postgres addon. Express serves SPA + demo apps + API on same domain. CORS eliminated. WS URL derived from `window.location.host`. Demo app URLs in DB are relative paths (`/apps/chess`).

---

## Q13: Sandbox Attributes with Same-Origin Serving

**Question:** Critical security implication of same-origin serving: if the chess app is served from the same domain as the platform (e.g., `myapp.railway.app/apps/chess/`), then `sandbox="allow-scripts allow-same-origin"` would give the iframe full access to the parent's cookies, localStorage, and DOM. How do you handle this?

Options presented:
- Keep `sandbox="allow-scripts"` only — no `allow-same-origin`.
- Use `allow-same-origin` for demo apps since they're trusted.
- Host apps on a subdomain or separate origin.

**Answer:** Keep `sandbox="allow-scripts"` only — no `allow-same-origin`.

**Decision:** `allow-scripts` only. No exceptions for demo apps even though they're self-hosted. The iframe sandbox is the security boundary regardless of serving origin.

---

## Q14: postMessage Origin Validation with Same-Origin Sandboxed Iframes

**Question:** With same-origin serving, the postMessage origin validation changes. The SPEC says validate `event.origin` against the registered app URL — but if chess is at `myapp.railway.app/apps/chess/`, `event.origin` will be `'https://myapp.railway.app'`, the same as the platform. Origin alone can't distinguish platform from iframe. Does `event.source` validation (checking it's the specific iframe ref) become the primary security check?

Options presented:
- Yes — `event.source` is the primary check. Origin == platform origin for all demo apps.
- This is a bug — need to rethink serving strategy.
- Not a problem — source check was always enough.

**Answer:** Actually, this is a non-issue because of the sandbox. With `sandbox="allow-scripts"` and no `allow-same-origin`, the browser assigns the iframe a unique opaque origin. `event.origin` for messages from a sandboxed iframe will be the string `"null"` — not `https://myapp.railway.app`. So the platform's origin and the iframe's origin are already different. They can't collide.

That said, `event.origin === "null"` is useless for distinguishing between multiple sandboxed iframes since they all report `"null"`. So yes, `event.source === iframeRef.current?.contentWindow` is the primary check. It's unforgeable — a sandboxed iframe can't spoof another iframe's `contentWindow` reference.

The validation stack is:
1. `event.source === iframeRef.current?.contentWindow` — is this from the iframe I expect?
2. `event.data?.type` exists and is in the known message type set — is this a valid protocol message?
3. Parse with the Zod `BridgeMessageSchema` — does the structure match?

For production third-party apps hosted on their own domains (not sandboxed same-origin), `event.origin` becomes meaningful again and gets added as an additional check. But for the sprint with same-origin sandboxed iframes, source + structure validation is the correct and complete security model.

**Decision:** Sandboxed `allow-scripts`-only iframes get opaque `null` origin. `event.source === iframeRef.current?.contentWindow` is the primary (unforgeable) security check. Zod schema validation is structural check. `event.origin` added back only for production third-party apps at different domains.

---

## Q15: Pipeline Switch Mechanism in Chatbox Frontend

**Question:** One thing the SPEC doesn't cover: how does the Chatbox frontend actually switch between its existing client-side LLM pipeline and the new backend WebSocket pipeline? What's the trigger in the Chatbox UI code, and where does the session-level flag live?

Options presented:
- `chatBridgeStore` flag, checked in `InputBox` submit handler.
- New chat type added to `Session` schema (`type: 'chatbridge'`).
- Separate route for ChatBridge chat (`/chatbridge/:sessionId`).

**Answer:** Option 1 is closest, but the interception point matters. I'm not modifying `InputBox.tsx` — that's deep in Chatbox's existing code and I want to minimize changes to upstream files. The switch happens one level down, in `submitNewUserMessage` in `src/renderer/stores/session/messages.ts`.

The flow in Chatbox is: `InputBox` calls `submitNewUserMessage` → which calls `generate` → which calls `streamText` → which calls `model.chat()`. My interception is at the `generate` step. The `chatBridgeStore` has an `activeSession: Map<string, ChatBridgeSessionState>` keyed by session ID. In `generate()` at `generation.ts:110`, before it calls `streamText`, I check if this session ID has an active ChatBridge context. If yes, instead of calling the local `streamText` pipeline, I send the message over the WebSocket and handle the streaming response from the backend.

This means:
- `InputBox.tsx` is untouched — it always calls `submitNewUserMessage` the same way
- `submitNewUserMessage` in `messages.ts` is untouched — it still inserts the user message and calls `generate`
- `generate` in `generation.ts` is the one file I modify — adding a conditional branch at the top
- Everything below `generate` (`streamText`, `model.chat`, providers) is untouched for non-ChatBridge sessions

The flag gets set when `activate_app` resolves. The first tool call to `activate_app` triggers: `chatBridgeStore` marks this session as ChatBridge-enabled, opens the WebSocket connection if not already open, and all subsequent `generate` calls for this session route through the backend. The flag persists in `chatBridgeStore` for the duration of the session — it doesn't need to survive page refresh because ChatBridge sessions are loaded from Postgres anyway.

This is a one-file modification to Chatbox core code (`generation.ts`), not three. Minimal blast radius.

**Decision:** Interception at `generate()` in `generation.ts:110`. One conditional branch added. `chatBridgeStore.isActive(sessionId)` is the flag. `InputBox.tsx`, `messages.ts`, `streamText`, and all providers untouched.

---

## Q16: First-Turn Tool Availability (The Bootstrapping Problem)

**Question:** There's a tension I want to probe. You said the session switches to WebSocket mode on first app activation. But `activate_app` is a tool that the LLM calls. For the LLM to call `activate_app`, the tool must be in scope. If the first message ('let's play chess') goes through the existing client-side pipeline, how does `activate_app` get into the LLM's tool set for that first turn?

Options presented:
- `activate_app` is injected into the client-side pipeline: It's added to the Chatbox tool set at `stream-text.ts:296`. Its `execute()` triggers the WebSocket switch.
- All messages go through the backend from session start.
- The first message is a special pre-flight to the backend.

**Answer:** Option 1. The `activate_app` tool lives in the existing Chatbox tool set — injected at `stream-text.ts` line ~296 alongside MCP tools. It's always in scope for every ChatBridge-aware session. Its schema is tiny (one string param: `appName`), so the token cost is negligible.

The first message ("let's play chess") goes through the normal client-side Chatbox LLM pipeline. The LLM sees `activate_app` in its tools, calls it. The `execute` function for `activate_app` doesn't do a postMessage round-trip to an iframe — it's a local function that:
1. Looks up the app in the registry (fetched from `GET /api/apps` on session start, cached in `chatBridgeStore`)
2. Opens the WebSocket connection to the backend
3. Marks this session as ChatBridge-enabled in `chatBridgeStore`
4. Opens the iframe side panel with the app URL
5. Returns `{ status: "activated", app: "chess", tools: ["start_game", "make_move", "get_board_state"] }` as the tool result

The LLM gets that result, sees the chess tools are now available, and on its next turn it calls `start_game`. But that next turn goes through the backend WebSocket pipeline because the session is now switched.

So the sequence is: first message → client-side pipeline → `activate_app` executes locally → session switches → all subsequent messages → backend WebSocket pipeline. The LLM experiences this as a seamless two-turn interaction: "I activated chess, now I'll start a game."

This means `activate_app` is the only tool that executes client-side. Every other plugin tool goes through the backend. That's a clean boundary — one special meta-tool that bootstraps the whole system.

**Decision:** `activate_app` executes CLIENT-SIDE (injected at `stream-text.ts:296`). It is the ONLY plugin tool that runs client-side. Its `execute()` opens WS, updates store, opens iframe, returns tool result. All subsequent app tools route through the backend. Clean boundary: one bootstrapping tool, everything else via WS.

---

## Q17: Error States and Test App Strategy

**Question:** Two things I haven't covered yet — pick one to address first: (A) Error states and circuit breaker: what does the user see when a tool times out, when the iframe fails to load, or when the circuit breaker trips after 3 failures? Or (B) The test-app (protocol mock): are you building `apps/test-app/index.html` as a dedicated protocol compliance fixture, or relying on the chess app itself to serve as the integration test target?

**Answer:** Both, quickly — neither needs a deep dive at this point.

Error states: The UX is simple and consistent. Tool timeout (10s) → a chat bubble appears from the assistant: "The chess app didn't respond. Would you like to try again?" with a "Retry" button inline. Iframe fails to load (5s) → the side panel shows a centered error card: "[App name] failed to load" with a "Retry" / "Close" button. Circuit breaker trips (3 consecutive failures) → the side panel closes, a system message appears in chat: "The chess app is having issues and has been deactivated for this session. You can continue chatting normally." The app's tools are removed from the LLM's tool set so it stops trying to invoke them. In all cases, the chat itself never breaks — the error is just content in the conversation, not a crash state.

Test app: Yes, I'm building `apps/test-app/index.html` — it's 30 lines of HTML and it's the first app I wire up, before chess. It implements the full protocol with hardcoded responses: sends `ready`, registers one dummy tool, responds to `tool_invoke` with a canned `tool_result`, sends a `state_update` on a timer, sends `completion` after 3 invocations. I use this to prove the platform's postMessage handling, tool injection, iframe lifecycle, and completion signaling all work before I spend time on chess.js and react-chessboard. Once the test app works end-to-end, building chess is just swapping the app logic — the protocol layer is proven. The test app stays in the repo as a protocol reference and integration test fixture.

**Decision (errors):** Tool timeout → inline chat bubble + Retry. Iframe fail → panel error card + Retry/Close. Circuit breaker (3 failures) → panel closes + system message + tools removed. Chat never crashes. **Decision (test app):** `apps/test-app/index.html` is built FIRST before chess as a 30-line protocol compliance fixture. Proves platform end-to-end before any real app logic is written.

---

## Q18: App State to Backend (FEN in System Prompt)

**Question:** One gap I haven't seen addressed: how does the backend know the current app state (e.g., current chess FEN) when constructing the system prompt for LLM calls? The state arrives via postMessage to the frontend — but the backend makes the OpenAI calls. Does the client include current app state in every WebSocket `user_message` it sends?

Options presented:
- Client includes `appState` in every WS message: Payload includes `appContext: { states: { chess: { fen, moveCount } } }`.
- Backend tracks state via its own messages: Client forwards `state_update` to backend via dedicated WS message.
- Both — forwarding primary, piggybacking as fallback.

**Answer:** Option 1 — the client piggybacks the current state snapshot on every `user_message`. The WebSocket payload becomes:

```json
{
  "type": "user_message",
  "conversationId": "uuid",
  "content": "what should I do here?",
  "appContext": {
    "activeApps": ["chess"],
    "states": {
      "chess": { "fen": "r1bqkb1r/pppppppp/2n2n2/...", "moveCount": 5, "turn": "white" }
    }
  }
}
```

The backend reads `appContext`, formats it into the system prompt ("A chess game is in progress. Board state: [FEN]. 5 moves played. It's white's turn."), and passes it to OpenAI. No server-side state tracking needed.

This is simpler than option 2 because the backend is stateless between requests — it doesn't need an in-memory map of app states per session, no synchronization bugs, no race conditions between a `state_update` WebSocket message arriving just after a `user_message`. The client is the source of truth for app state because it's the one receiving postMessage updates from the iframe. It just snapshots the current state at the moment the user sends a message.

If no app is active, `appContext` is omitted or empty, and the backend constructs a system prompt with no app context — which is the normal chat case.

**Decision:** Client piggybacks `appContext` (with current state snapshots) on every `user_message` WS payload. Backend is stateless between requests. No server-side state tracking, no race conditions. Backend formats `appContext` into the Anthropic `system` parameter for each Claude API call.

---

## Q19: Auth UX and Demo Flow

**Question:** Auth implementation: the SPEC shows custom JWT (register/login/refresh). For the sprint demo, what's the user experience? Does the grader need to create an account and log in before they can see the chat? Or is there a way to skip auth for local dev / demo mode?

Options presented:
- Full auth required, demo credentials provided.
- Auto-login / dev bypass via `?demo=true`.
- Auth is just JWT on API/WebSocket — no login UI yet, demo uses hardcoded token.

**Answer:** Both — full auth exists, but friction-free for the grader. The deployed app has a real login/register page. But the landing page has two paths: "Create Account" and a prominent "Try Demo" button that auto-creates a guest session with a pre-seeded demo user. The grader clicks one button and they're in — no email, no password, no friction. The demo user has all three apps pre-approved and a clean conversation history.

The auth system is real and fully functional — register, login, JWT issuance, refresh, protected routes, rate limiting. A grader who wants to test auth can create their own account and see the full flow. But the happy path for evaluation is: click "Try Demo" → land in the chat → say "let's play chess" → everything works. Zero seconds wasted on an account creation form.

For local dev, the seed script creates the demo user automatically (`npm run seed` creates `demo@chatbridge.app` with a known password plus the three demo app registrations). No env var toggle or dev bypass — the seed data handles it.

Build order: backend auth endpoints and middleware first (day 1, needed for WebSocket), login/register UI last (day 6-7, polish). The "Try Demo" button is a single `POST /api/auth/demo` endpoint that returns a JWT for the pre-seeded user — maybe 10 lines of code. If I run out of time on the auth UI, the demo button alone is sufficient for grading.

**Decision:** Real auth system (register/login/refresh/middleware). `POST /api/auth/demo` returns JWT for pre-seeded `demo@chatbridge.app` user — single button click, no form. `npm run seed` creates demo user + 3 approved app registrations. Auth UI built last (day 6-7).

---

## Q20: Conversation History Persistence

**Question:** Last gap: the grading criteria mentions 'persistent conversation history.' What exactly needs to persist and survive? If a user closes the browser and comes back, what do they see in the ChatBridge session — and does the chess board state restore?

Options presented:
- Messages persist, app state does not: Conversation text + tool calls in Postgres. Board does NOT restore.
- Messages + last app state persist: Last `state_update` per app stored in Postgres, sent to iframe on reload.
- Messages persist, app state is reconstructable: App replays move history from tool results. App's responsibility.

**Answer:** Option 1 as the baseline, with option 3 as an optional enhancement the app can choose to implement. The platform's contract is clear: conversation messages persist in Postgres, app state does not. That's the platform's responsibility boundary.

When a user comes back, they see the full chat history: every user message, every assistant response, every tool call and tool result. The conversation reads like a transcript — "You started a chess game as white. You played e4, opponent played e5..." etc. The LLM has full context from the message history and can discuss the game that happened.

The chess iframe loads fresh. The board is empty. The side panel could show a message like "Previous game session ended" based on the conversation having a completion signal in its history. This is fine — it matches user expectations. If you close a browser tab during an online chess game, you don't expect the board to magically restore.

However, the platform sends one optional signal when an iframe loads in a session that has prior app history: `{ type: 'restore', lastState: { fen: "...", moveCount: 12 } }` — the last state that was included in a `user_message`'s `appContext`. If the chess app wants to handle this and restore the board, it can. If it ignores it, that's fine too. This is a platform convenience, not a requirement on apps.

For the sprint, I implement the message persistence (required, graded) and the restore signal (cheap to add since `appContext` is already in the `user_message` payloads stored in Postgres). Whether the chess app actually handles restore is a stretch goal — the conversation history alone satisfies "persistent conversation history across sessions."

**Decision:** Platform contract: messages persist in Postgres, app state does not. Platform optionally sends `{ type: 'restore', lastState }` when iframe loads in a session with prior history. Chess app restore is a stretch goal. Conversation transcript in chat is the primary persistence deliverable.

---

## Summary of Key Decisions

| Topic | Decision | Rationale |
|---|---|---|
| Build sequence | Thin backend scaffold → vertical slice (test-app) → chess → auth UI → weather → Spotify | WebSocket↔postMessage handoff is the riskiest integration — prove it first |
| WebSocket↔postMessage handoff | Client drives continuation (multi-turn) | Matches how Anthropic tool use actually works; stream completes when `stop_reason: "tool_use"` is emitted |
| Multi-tool synchronization | Collect all tool results, send as batch | Simpler server-side; avoids partial continuation |
| iframe placement | Side panel (right of chat), reusing Artifact.tsx layout | Chatbox already has the layout infrastructure; user sees chat + board simultaneously |
| LLM pipeline split | Parallel — Chatbox pipeline untouched; backend WS only for ChatBridge sessions | Reimplementing Chatbox's full pipeline would be days of work for zero benefit |
| Session activation trigger | Hybrid: app list summary in system prompt, full schemas only for active apps | Handles all 7 grading scenarios; controls token cost |
| App activation mechanism | `activate_app({ appName })` meta-tool always in scope | Deterministic, tiny schema; doubles as session mode switch |
| `activate_app` execution site | Executes CLIENT-SIDE at `stream-text.ts:296` | Only tool that must run before WS session exists; bootstraps the whole system |
| Pipeline switch location | Conditional branch at top of `generate()` in `generation.ts:110` | Minimal blast radius: one file modified, nothing below it touched for non-ChatBridge sessions |
| Chess board library | react-chessboard + chess.js | React-native, declarative FEN API, actively maintained |
| Chess user move handling | Direct in iframe: chess.js validates, `state_update` sent | LLM not involved in move execution; avoids latency on every drag |
| Demo app priority | Chess → Weather → Spotify | Each demonstrates distinct integration pattern; Spotify OAuth is highest risk, built last |
| OAuth token path | Token stays server-side; iframe gets `auth_ready` signal only | More secure; simpler; token refresh handled transparently |
| Railway topology | One service + Postgres addon. Express serves SPA + demo apps + API | Eliminates CORS entirely; WS URL derived from `window.location.host` |
| Sandbox attributes | `allow-scripts` only, no `allow-same-origin` | Maintains security boundary even for same-origin served apps |
| postMessage origin validation | Sandboxed iframes get opaque `null` origin; `event.source` is primary check | `allow-scripts`-only sandbox makes origin check moot; source check is unforgeable |
| App state → backend | Client piggybacks `appContext` on every `user_message` WS payload | Backend stateless between requests; no race conditions; client is source of truth |
| Auth UX | Real auth + `POST /api/auth/demo` → single click, no form | Demonstrates full auth system while removing grading friction |
| Conversation persistence | Messages in Postgres (required). Optional `restore` signal to iframe. App state not persisted. | Platform's responsibility boundary is the conversation transcript; board restore is a stretch goal |
| Test app | `apps/test-app/index.html` — 30-line protocol fixture, built BEFORE chess | Proves platform-side of protocol without depending on real app logic |
| Error handling | Timeout → inline retry. Iframe fail → panel error card. Circuit breaker (3 failures) → panel closes + system message | Chat never crashes; all errors are content, not crash states |
