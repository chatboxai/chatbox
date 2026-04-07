# ChatBridge

An AI chat platform with third-party app integration, built on [Chatbox](https://github.com/Bin-Huang/chatbox). Third-party apps register tools, render custom UI inside the chat via sandboxed iframes, and communicate bidirectionally with the LLM through a typed postMessage protocol.

Built for the TutorMeAI case study — a K-12 education platform where 200,000+ students and teachers interact with AI daily. Safety, data isolation, and cost control are designed in from the start.

**Live demo:** [https://chatbridge.up.railway.app](https://chatbridge.up.railway.app)

---

## Features

- **AI Chat** — Real-time streaming chat powered by Anthropic Claude Sonnet 4.6 with persistent conversation history
- **Plugin System** — Third-party apps register tools via REST API or postMessage, render UI in sandboxed iframes, and communicate with the LLM through a typed message protocol
- **Three Demo Apps** — Chess (stateful game with AI analysis), Weather Dashboard (external API, no auth), Spotify Playlist Creator (full OAuth2 flow)
- **User Authentication** — JWT-based platform auth with bcrypt password hashing
- **OAuth Integration** — Popup-based OAuth flow for third-party apps that need user authorization
- **Context Awareness** — LLM maintains awareness of app state throughout multi-turn conversations
- **Error Recovery** — Timeouts, circuit breakers, and graceful degradation when apps fail

---

## Architecture

```
Browser                                    Server
┌─────────────┐  postMessage  ┌─────────┐
│ Chatbox SPA │◄─────────────►│ App     │
│ (React 18)  │               │ (iframe)│
└──────┬──────┘               └─────────┘
       │ WebSocket
┌──────▼──────────────────────────────────┐
│ Express Backend                          │
│  Auth │ Chat/LLM │ App Registry │ OAuth │
│                  │                       │
│            PostgreSQL (Prisma)           │
└──────────────────────────────────────────┘
```

Two separate communication channels: **WebSocket** for client ↔ server (chat, LLM streaming, persistence) and **postMessage** for parent window ↔ iframe (tool invocations, state updates, completion signals).

---

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL (or Railway Postgres addon)
- Anthropic API key

### Setup

```bash
# Clone the repo
git clone https://gitlab.com/your-username/chatbridge.git
cd chatbridge

# Install frontend dependencies
pnpm install

# Set up the backend
cd server
npm install
cp .env.example .env
# Edit .env with your database URL, Anthropic API key, and JWT secret

# Run database migrations
npx prisma migrate dev

# Seed demo apps
npm run seed
```

### Environment Variables

Create `server/.env`:

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/chatbridge
ANTHROPIC_API_KEY=sk-ant-...
JWT_SECRET=your-random-secret-here
SPOTIFY_CLIENT_ID=...          # Optional, for Spotify app
SPOTIFY_CLIENT_SECRET=...      # Optional, for Spotify app
WEATHER_API_KEY=...            # Optional, for Weather app
PORT=3000
CLIENT_URL=http://localhost:5173
```

### Run Development

```bash
# Terminal 1: Frontend (Vite dev server)
pnpm run dev

# Terminal 2: Backend
cd server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### Build for Production

```bash
# Frontend
pnpm run build:web

# Backend
cd server
npm run build
npm start
```

---

## Plugin Development

### Minimum Viable Plugin

A ChatBridge plugin is any web page that implements the postMessage protocol. Here's a complete example:

```html
<!-- my-plugin.html -->
<h1>Hello Plugin</h1>
<div id="result"></div>

<script>
  // 1. Tell the platform we're ready
  window.parent.postMessage({ type: 'ready' }, '*')

  // 2. Register tools
  window.parent.postMessage({
    type: 'register_tools',
    schemas: [{
      name: 'greet',
      description: 'Greet someone by name',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name to greet' }
        },
        required: ['name']
      }
    }]
  }, '*')

  // 3. Handle tool invocations
  window.addEventListener('message', (event) => {
    if (event.data.type === 'tool_invoke') {
      const { toolCallId, toolName, params } = event.data

      if (toolName === 'greet') {
        document.getElementById('result').textContent = `Hello, ${params.name}!`

        // 4. Return result to platform
        window.parent.postMessage({
          type: 'tool_result',
          toolCallId,
          result: { greeting: `Hello, ${params.name}!` }
        }, '*')
      }
    }
  })
</script>
```

### Register Your Plugin

```bash
curl -X POST https://chatbridge.up.railway.app/api/apps/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT" \
  -d '{
    "name": "Greeter",
    "url": "https://your-plugin-url.com",
    "description": "A simple greeting plugin",
    "tools": [{
      "name": "greet",
      "description": "Greet someone by name",
      "parameters": {
        "type": "object",
        "properties": {
          "name": { "type": "string" }
        },
        "required": ["name"]
      }
    }]
  }'
```

### Plugin Lifecycle

```
Register (REST API)
    ↓
Iframe loads → sends { type: 'ready' }
    ↓
Optional: sends { type: 'register_tools' } to update schemas dynamically
    ↓
Receives { type: 'tool_invoke' } when LLM calls a tool
    ↓
Sends { type: 'tool_result' } with execution result
    ↓
Optionally sends { type: 'state_update' } as state changes
    ↓
Sends { type: 'completion' } when interaction is done
```

### Message Reference

**Incoming (Platform → Your App):**

| Message | Fields | Description |
|---|---|---|
| `tool_invoke` | `toolCallId`, `toolName`, `params` | LLM wants your app to do something |
| `auth_token` | `token`, `provider` | OAuth token is available for API calls |

**Outgoing (Your App → Platform):**

| Message | Fields | Description |
|---|---|---|
| `ready` | — | App loaded and ready to receive invocations |
| `register_tools` | `schemas` | Declare or update available tools |
| `tool_result` | `toolCallId`, `result` | Return result of a tool invocation |
| `state_update` | `state` | Push state changes to the LLM context |
| `completion` | `result` | Signal that the interaction is finished |

---

## API Endpoints

### Auth

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Create account (email + password) |
| POST | `/api/auth/login` | Login → returns JWT |
| POST | `/api/auth/refresh` | Refresh JWT |

### Conversations

| Method | Path | Description |
|---|---|---|
| GET | `/api/conversations` | List user's conversations |
| GET | `/api/conversations/:id` | Get conversation with messages |
| POST | `/api/conversations` | Create new conversation |
| DELETE | `/api/conversations/:id` | Delete conversation |

### App Registry

| Method | Path | Description |
|---|---|---|
| GET | `/api/apps` | List approved apps |
| POST | `/api/apps/register` | Register a new app |
| PATCH | `/api/apps/:id/status` | Approve/reject an app (admin) |

### OAuth

| Method | Path | Description |
|---|---|---|
| GET | `/api/oauth/:provider/authorize` | Start OAuth flow (opens in popup) |
| GET | `/api/oauth/:provider/callback` | OAuth callback (exchanges code for tokens) |

### WebSocket

Connect to `ws://host/ws` with JWT in the query string or as a cookie. Message format:

```json
{ "type": "user_message", "conversationId": "...", "content": "let's play chess" }
{ "type": "token", "data": "Here" }
{ "type": "tool_call", "toolCallId": "...", "toolName": "start_game", "params": {...} }
{ "type": "done" }
```

---

## Project Structure

```
chatbridge/
├── src/                          # Chatbox frontend (forked)
│   ├── renderer/
│   │   ├── components/
│   │   │   └── ChatBridgeFrame.tsx    # Plugin iframe container
│   │   ├── stores/
│   │   │   └── chatBridgeStore.ts     # Plugin state (Zustand)
│   │   └── packages/
│   │       ├── chatbridge/
│   │       │   ├── controller.ts      # Plugin lifecycle manager
│   │       │   └── tool-bridge.ts     # Schema → AI SDK ToolSet conversion
│   │       └── model-calls/
│   │           ├── stream-text.ts     # LLM call pipeline (modified)
│   │           └── message-utils.ts   # System prompt injection (modified)
│   └── shared/types/
│       └── chatbridge.ts             # Plugin type definitions
├── server/                       # Express backend (new)
│   ├── src/
│   │   ├── index.ts              # Express + WebSocket server
│   │   ├── routes/
│   │   │   ├── auth.ts           # JWT auth endpoints
│   │   │   ├── conversations.ts  # Chat CRUD
│   │   │   ├── apps.ts           # App registry
│   │   │   └── oauth.ts          # OAuth flows
│   │   ├── middleware/
│   │   │   ├── auth.ts           # JWT verification
│   │   │   └── rateLimit.ts      # Per-user/per-app rate limiting
│   │   └── ws/
│   │       └── chat.ts           # WebSocket handler + LLM streaming
│   └── prisma/
│       └── schema.prisma         # Database schema
├── apps/                         # Third-party demo apps
│   ├── chess/                    # Chess game (stateful, no auth)
│   ├── weather/                  # Weather dashboard (API key, no user auth)
│   └── spotify/                  # Spotify playlists (OAuth2)
├── SPEC.md                       # Technical specification
├── CODEBASE_ANALYSIS.md          # Chatbox codebase reference
└── docs/
    └── presearch.pdf             # Pre-search document
```

---

## Deployment

### Railway (one service)

Express serves everything: API, WebSocket, demo app SPAs, and the built Chatbox frontend.

**Steps:**

1. Push to GitLab/GitHub and connect the repo to Railway
2. Add a **Postgres** plugin in Railway
3. Set these environment variables in Railway:

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `JWT_SECRET` | Yes | Random 32+ character string |
| `CLIENT_URL` | Yes | Your Railway service URL (e.g. `https://chatbridge.up.railway.app`) |
| `WEATHER_API_KEY` | No | OpenWeatherMap API key |
| `SPOTIFY_CLIENT_ID` | No | Spotify app client ID |
| `SPOTIFY_CLIENT_SECRET` | No | Spotify app client secret |

> `DATABASE_URL` and `PORT` are set automatically by Railway.

4. Deploy — Railway runs `npx prisma migrate deploy` automatically on start

**Build output:**
- Frontend → `release/app/dist/renderer/` (served at `/`)
- Chess app → `apps/chess/dist/` (served at `/apps/chess/`)
- Weather app → `apps/weather/dist/` (served at `/apps/weather/`)
- Spotify app → `apps/spotify/dist/` (served at `/apps/spotify/`)
- API → `/api/*`
- WebSocket → `/ws`

**Local production build test:**
```bash
pnpm build:all          # builds frontend + all apps + server
cd server && node dist/index.js
# visit http://localhost:3000
```

### Railway (recommended)

The project deploys as a single Railway project with three services:

1. **Backend** — Express server (auto-deploys from `server/` directory)
2. **Frontend** — Static site built from `pnpm run build:web` output
3. **Postgres** — Railway addon, connection string in env vars

Demo apps are served as separate paths from the Express server (`/apps/chess/`, `/apps/weather/`, `/apps/spotify/`).

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and init
railway login
railway init

# Add Postgres
railway add --plugin postgresql

# Deploy
railway up
```

---

## Documentation

| Document | Description |
|---|---|
| [SPEC.md](./SPEC.md) | Full technical specification — protocol, schemas, security model |
| [CODEBASE_ANALYSIS.md](./CODEBASE_ANALYSIS.md) | Chatbox codebase reference — architecture, extension points, file map |
| [docs/presearch.pdf](./docs/presearch.pdf) | Pre-search document — case study analysis + planning checklist |

---

## License

Forked from [Chatbox](https://github.com/Bin-Huang/chatbox) under GPL-3.0. ChatBridge additions follow the same license.
