# ChatBridge Technical Specification

## Overview

ChatBridge is a plugin system built on top of [Chatbox](https://github.com/Bin-Huang/chatbox) that enables third-party applications to register tools, render custom UI inside the chat, and communicate bidirectionally with the LLM — all within a sandboxed iframe boundary.

The platform targets K-12 education. Safety, data privacy, and cost control are first-class constraints, not afterthoughts.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Browser                            │
│                                                         │
│  ┌──────────────────────┐    ┌───────────────────────┐  │
│  │   Chatbox Frontend   │    │   Third-Party App      │  │
│  │   (React 18 SPA)     │◄──►│   (iframe, sandboxed)  │  │
│  │                      │ pm │                        │  │
│  │  ┌────────────────┐  │    └───────────────────────┘  │
│  │  │chatBridgeStore │  │           postMessage          │
│  │  │  (Zustand)     │  │                               │
│  │  └────────────────┘  │                               │
│  └──────────┬───────────┘                               │
│             │ WebSocket                                  │
└─────────────┼───────────────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────────────┐
│           Express Backend (Node.js)                      │
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │ Auth     │ │ Chat     │ │ App      │ │ OAuth     │  │
│  │ (JWT)    │ │ (WS+LLM) │ │ Registry │ │ (tokens)  │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘  │
│                      │                                   │
│              ┌───────▼────────┐                          │
│              │   PostgreSQL   │                          │
│              │   (Prisma)     │                          │
│              └────────────────┘                          │
└─────────────────────────────────────────────────────────┘
```

**Two communication channels, deliberately separate:**

1. **WebSocket** (client ↔ server): User messages, LLM streaming, conversation persistence.
2. **postMessage** (parent window ↔ iframe): Tool invocations, state updates, completion signals. Local to the browser — never touches the server.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Chatbox fork (React 18, Zustand, Jotai, TanStack Router/Query, Vite) |
| Backend | Node.js / Express + `ws` WebSocket server |
| Database | PostgreSQL on Railway via Prisma |
| Auth (platform) | Custom JWT (bcrypt + jsonwebtoken) |
| Auth (third-party) | OAuth2 via `simple-oauth2`, popup window flow |
| LLM | Anthropic Claude Sonnet 4.6 (`claude-sonnet-4-6`) via `@anthropic-ai/sdk` |
| Sandboxing | iframe + postMessage with origin validation |
| Deployment | Railway (backend + Postgres + static frontend) |

---

## Plugin Protocol

### Registration

Apps register via REST endpoint or dynamically via postMessage after iframe load.

**REST registration:**
```
POST /api/apps/register
{
  "name": "Chess",
  "url": "https://chess-app.railway.app",
  "description": "Interactive chess game with AI analysis",
  "tools": [
    {
      "name": "start_game",
      "description": "Start a new chess game",
      "parameters": {
        "type": "object",
        "properties": {
          "color": { "type": "string", "enum": ["white", "black"] }
        }
      }
    },
    {
      "name": "make_move",
      "description": "Make a chess move",
      "parameters": {
        "type": "object",
        "properties": {
          "from": { "type": "string" },
          "to": { "type": "string" }
        },
        "required": ["from", "to"]
      }
    },
    {
      "name": "get_board_state",
      "description": "Get the current board position as a FEN string",
      "parameters": { "type": "object", "properties": {} }
    }
  ]
}
```

**Dynamic registration (postMessage from iframe):**
```javascript
window.parent.postMessage({
  type: 'register_tools',
  schemas: [{ name, description, parameters }]
}, '*')
```

### Message Protocol

All messages are JSON objects with a `type` field. Origin is validated on every message received.

**Platform → App:**

| Type | Payload | When |
|---|---|---|
| `tool_invoke` | `{ toolCallId, toolName, params }` | LLM calls a tool |
| `auth_token` | `{ token, provider }` | OAuth token available |

**App → Platform:**

| Type | Payload | When |
|---|---|---|
| `tool_result` | `{ toolCallId, result }` | Tool execution complete |
| `state_update` | `{ state }` | App state changed (e.g., board position) |
| `completion` | `{ result }` | App interaction finished |
| `register_tools` | `{ schemas }` | App declares/updates its tools |
| `ready` | `{}` | App iframe loaded and ready |

### Lifecycle

```
1. User says "let's play chess"
2. LLM returns tool_call: start_game({ color: "white" })
3. Platform opens chess app iframe, sends tool_invoke via postMessage
4. App renders board, sends tool_result back
5. LLM responds: "Game started! You're playing white. Make your move."
6. User clicks a piece on the board (direct UI interaction)
7. App sends state_update with new FEN string
8. User asks "what should I do here?"
9. Platform injects current board state into system prompt
10. LLM analyzes position, suggests a move
11. Game ends — app sends completion signal
12. LLM: "Great game! You won by checkmate in 24 moves."
```

---

## Tool Injection

Tools are injected into the LLM call at `src/renderer/packages/model-calls/stream-text.ts` line ~296, alongside existing MCP tools:

```typescript
let tools: ToolSet = { ...mcpController.getAvailableTools() }

// ChatBridge tools injected here
if (chatBridgeEnabled) {
  tools = { ...tools, ...chatBridgeController.getTools() }
}
```

Each tool's `execute` function sends a `tool_invoke` postMessage to the iframe and returns a Promise that resolves when `tool_result` is received (or rejects on timeout).

App state context is injected into the system prompt via `injectModelSystemPrompt()` in `message-utils.ts`. Only schemas for actively opened apps are included — not all registered apps globally.

---

## Sandboxing & Security

### Iframe Attributes

```html
<iframe
  src="https://app-url.railway.app"
  sandbox="allow-scripts"
  referrerpolicy="no-referrer"
/>
```

`allow-same-origin` added only for trusted, self-hosted demo apps. Never combined with `allow-scripts` for untrusted third-party content.

### CSP Headers (Platform)

```
Content-Security-Policy: default-src 'self'; frame-src https://*.railway.app; script-src 'self'; connect-src 'self' https://api.anthropic.com
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
```

### Data Isolation

Apps receive only the structured parameters their tools declare. They never see conversation history, other apps' data, or user information. State updates flow through the platform — apps cannot inject arbitrary content into the LLM context.

### App Vetting

Registration includes a `status` field: `pending` → `approved` → `rejected`. Only approved apps are available to users. For the sprint, demo apps are self-approved. In production, this is a manual review gate.

---

## Authentication

### Platform Auth

Custom JWT flow on Express:

1. `POST /api/auth/register` — email + password → bcrypt hash → Postgres
2. `POST /api/auth/login` — verify password → issue JWT (24h expiry)
3. `POST /api/auth/refresh` — issue new JWT from valid existing token
4. JWT sent via httpOnly cookie or Authorization header on every request and WebSocket upgrade

### Third-Party OAuth

Popup window flow (iframes cannot handle OAuth redirects):

1. User clicks "Connect Spotify" → `window.open('/api/oauth/spotify/authorize')`
2. Backend redirects to Spotify auth page
3. User approves → Spotify redirects to `/api/oauth/spotify/callback`
4. Backend exchanges code for tokens, stores in `oauth_tokens` table
5. Callback page calls `window.opener.postMessage({ type: 'oauth_complete' })` and closes
6. Parent window notifies iframe that auth is ready

Tokens are refreshed automatically before each tool invocation. Users only re-auth if the refresh token expires.

---

## Database Schema

Six core tables via Prisma:

| Table | Key Fields | Purpose |
|---|---|---|
| `users` | id, email, password_hash | Platform accounts |
| `conversations` | id, user_id, title | Chat sessions |
| `messages` | id, conversation_id, role, content, tool_call_id | Chat + tool history |
| `app_registrations` | id, name, url, tool_schemas (JSONB), status | Plugin registry |
| `oauth_tokens` | id, user_id, provider, access_token, refresh_token | Third-party auth |
| `tool_invocations` | id, app_id, tool_name, params, result, duration_ms, status | Analytics/debugging |

Indexes: `messages(conversation_id, created_at)`, `app_registrations(status)`.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Iframe fails to load | 5s timeout → error shown in chat, iframe removed, tools not injected |
| Tool call times out | 10s default → error result injected into LLM, user sees friendly message |
| App crashes mid-session | Error injected as tool result, conversation continues normally |
| 3 consecutive failures | Circuit breaker: app tools removed for remainder of session |
| OAuth token expired | Auto-refresh via refresh token; re-auth prompt only if refresh token expired |

Core principle: a broken app never breaks the chat.

---

## Third-Party Apps (Demo)

Three apps demonstrating different integration patterns:

| App | Complexity | Auth | Key Challenge |
|---|---|---|---|
| Chess | High | None | Ongoing state, bidirectional communication, mid-game AI analysis |
| Weather Dashboard | Low | API key (server-side) | External API, no user auth, UI rendering |
| Spotify Playlist | Medium | OAuth2 (user auth) | Full OAuth flow, external API, token management |

---

## Cost Model

| Scale | Estimated Monthly LLM Cost | Assumptions |
|---|---|---|
| 100 users | ~$75 | 5 sessions/user/month, 10 tool invocations/session, ~2K input + 500 output tokens per call |
| 1,000 users | ~$650 | Same pattern, prompt caching reduces input cost ~20% on cache hits |
| 10,000 users | ~$5,500 | Aggressive context summarization saves ~30% |
| 100,000 users | ~$45,000 | Prompt caching + tool result caching |

Pricing basis: Claude Sonnet 4.6 at ~$3/M input tokens, ~$15/M output tokens. Single model for all calls — no model-routing logic needed.

Infrastructure costs (Railway) are negligible at all scales relative to LLM spend.

---

## Files to Create

| File | Purpose |
|---|---|
| `src/renderer/stores/chatBridgeStore.ts` | Zustand store: plugin registry, active app state |
| `src/renderer/packages/chatbridge/controller.ts` | Plugin lifecycle: load, start, stop, getTools() |
| `src/renderer/packages/chatbridge/tool-bridge.ts` | Convert plugin manifests to AI SDK ToolSet |
| `src/renderer/components/ChatBridgeFrame.tsx` | iframe component (extends Artifact.tsx pattern) |
| `src/shared/types/chatbridge.ts` | Zod schemas: PluginManifest, BridgeMessage |
| `server/` | Express backend: auth, chat API, app registry, OAuth, WebSocket |
| `server/prisma/schema.prisma` | Database schema |
| `apps/chess/` | Chess third-party app |
| `apps/weather/` | Weather dashboard third-party app |
| `apps/spotify/` | Spotify playlist third-party app |

## Files to Modify

| File | Change |
|---|---|
| `src/renderer/packages/model-calls/stream-text.ts` | Inject ChatBridge tools at line ~296 |
| `src/renderer/packages/model-calls/message-utils.ts` | Inject app state into system prompt |
| `src/shared/types/settings.ts` | Add ChatBridgeSettings schema |
| `src/renderer/stores/settingsStore.ts` | Expose chatBridge settings |
| `src/renderer/routes/chat/` | Render ChatBridgeFrame panel |
