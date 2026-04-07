# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

ChatBridge is a plugin system built on a fork of [Chatbox](https://github.com/Bin-Huang/chatbox) that enables third-party apps to register tools, render custom UI inside the chat via sandboxed iframes, and communicate bidirectionally with the LLM through a typed postMessage protocol. Targets K-12 education (TutorMeAI case study).

**Stack:** React 18 · Zustand · TanStack Router/Query · Vite · Node.js/Express · WebSocket (`ws`) · PostgreSQL (Prisma) · Anthropic Claude Sonnet 4.6 · iframe + postMessage

**Do not suggest switching frameworks or languages.** The Chatbox fork and Express backend are intentional choices documented in the pre-search.

## Reference Documents

Read these before making architectural decisions:
- `chatbridge/docs/CODEBASE_ANALYSIS.md` — Chatbox codebase structure, extension points, file/line anchors. **Read this file first before using codebase-memory-mcp.** It is authoritative for all structural questions it covers. Only query codebase-memory-mcp for questions not answered in this document (e.g., newly added files, call paths not mapped, or post-index changes).
- `chatbridge/docs/SPEC.md` — Plugin protocol, message types, security model, database schema.
- `chatbridge/docs/G4_Week_7_-_ChatBridge.md` — Full project requirements, deadlines, grading criteria, testing scenarios.
- `chatbridge/README.md` — Setup guide, API endpoints, plugin development docs.
- `.claude/rules/` — Code style, security, testing, and API contract rules.
- `.claude/skills/` — Skills for Railway deployment, Prisma, WebSocket, React, Node.js patterns.

## Commands

### Frontend (Chatbox fork)
```bash
pnpm install                          # Install dependencies
pnpm run dev                          # Vite dev server (hot reload)
pnpm run build:web                    # Production web build → dist/
pnpm run typecheck                    # TypeScript type checking
```

### Backend (Express server)
```bash
cd server
npm install                           # Install dependencies
npm run dev                           # Dev server with ts-node + nodemon
npm run build                         # Compile TypeScript
npm start                             # Start production server
npx prisma migrate dev                # Run database migrations
npx prisma studio                     # GUI for inspecting database
npm run seed                          # Seed demo app registrations
```

### Testing
```bash
pnpm run typecheck                    # Frontend type checking
cd server && npm test                 # Backend tests
cd server && npm run test:watch       # Watch mode
cd apps/chess && npm test             # Chess app tests
```

### Linting & Formatting
```bash
pnpm run lint                         # Biome lint (frontend)
cd server && npm run lint             # ESLint (backend)
```

## Environment Variables

### Backend (`server/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key for LLM calls |
| `JWT_SECRET` | Yes | — | Secret for signing JWTs |
| `PORT` | No | `3000` | Express server port |
| `CLIENT_URL` | No | `http://localhost:5173` | Frontend URL (CORS) |
| `SPOTIFY_CLIENT_ID` | No | — | Spotify OAuth (for Spotify app) |
| `SPOTIFY_CLIENT_SECRET` | No | — | Spotify OAuth secret |
| `WEATHER_API_KEY` | No | — | Weather API key |

## Project Structure

```
chatbox/
├── src/renderer/                      # Chatbox frontend (forked)
│   ├── components/
│   │   └── ChatBridgeFrame.tsx        # Plugin iframe container (NEW)
│   ├── stores/
│   │   └── chatBridgeStore.ts         # Plugin state — Zustand (NEW)
│   ├── packages/
│   │   ├── chatbridge/                # Plugin system (NEW)
│   │   │   ├── controller.ts          # Plugin lifecycle: load, start, stop, getTools()
│   │   │   └── tool-bridge.ts         # Schema → AI SDK ToolSet conversion
│   │   └── model-calls/
│   │       ├── stream-text.ts         # LLM pipeline (MODIFIED — inject ChatBridge tools at ~line 296)
│   │       └── message-utils.ts       # System prompt (MODIFIED — inject app state context)
│   └── shared/types/
│       └── chatbridge.ts              # Plugin types — Zod schemas (NEW)
├── server/                            # Express backend (NEW)
│   ├── src/
│   │   ├── index.ts                   # Express + WebSocket bootstrap
│   │   ├── routes/                    # REST endpoints
│   │   ├── middleware/                # Auth, rate limiting
│   │   └── ws/                        # WebSocket chat handler
│   └── prisma/schema.prisma           # Database schema
├── apps/                              # Third-party demo apps (NEW)
│   ├── chess/                         # Stateful game, no auth
│   ├── weather/                       # External API, server-side key
│   └── spotify/                       # OAuth2 flow
├── chatbridge/                        # ChatBridge project docs
│   └── docs/
│       ├── CODEBASE_ANALYSIS.md       # Chatbox codebase reference (read before MCP queries)
│       ├── SPEC.md                    # Plugin protocol spec
│       └── G4_Week_7_-_ChatBridge.md  # Project requirements
└── docs/                              # Pre-search, architecture docs
```

## Key Extension Points (from chatbridge/docs/CODEBASE_ANALYSIS.md)

| What | Where | Line |
|---|---|---|
| Tool set assembly | `src/renderer/packages/model-calls/stream-text.ts` | ~296 |
| System prompt injection | `src/renderer/packages/model-calls/message-utils.ts` | ~119 |
| Pre-generation hook | `src/renderer/stores/session/messages.ts` | ~111 |
| Generation lifecycle | `src/renderer/stores/session/generation.ts` | ~110 |
| iframe/postMessage pattern | `src/renderer/components/Artifact.tsx` | — |
| MCP tool integration | `src/renderer/packages/mcp/controller.ts` | ~197 |

## Architecture Rules

- **Two communication channels:** WebSocket (client ↔ server) for chat/LLM streaming. postMessage (parent ↔ iframe) for plugin communication. These are deliberately separate.
- **Apps own their state.** The platform receives a copy via `state_update` postMessage for LLM context injection. The platform never writes app state.
- **Selective tool injection.** Only inject schemas for actively opened apps, not all registered apps globally. This controls token cost.
- **Thin plugin contract.** Apps register URL + tool schemas. Platform handles discovery and routing. Apps handle execution and state.
- **Broken apps never break chat.** Tool timeouts inject error results into the conversation. The LLM handles them gracefully.

## Key Design Decisions

- **Express backend added to a client-side app** — Chatbox is pure-client (IndexedDB, no server). We add a backend for user auth, persistent history, and OAuth token storage. LLM calls move server-side to protect API keys.
- **iframe + postMessage for sandboxing** — Extends the existing `Artifact.tsx` pattern. Browser-enforced security boundary. Origin validated on every message.
- **Custom JWT auth over managed service** — Avoids vendor dependency during a one-week sprint. Half-day implementation cost is acceptable.
- **Claude Sonnet 4.6 as the single model** — One model for all calls (chat, tool routing, chess analysis). Eliminates model-switching logic. ~$3/M input, ~$15/M output tokens.
- **Prisma over raw SQL** — Typed queries match TypeScript-everywhere approach. Auto-generated migrations for a shifting schema.

## Git Workflow

### Conventional Commits
```
<type>(<scope>): <description>
```

**Types:** feat, fix, test, docs, refactor, chore, perf
**Scopes:** chatbridge, server, auth, chess, weather, spotify, plugin, ws, prisma, deploy
**Rules:** Lowercase, imperative mood, under 72 chars, no period.

**Examples:**
```
feat(chatbridge): add postMessage handler for tool_invoke and tool_result
feat(server): implement JWT auth with bcrypt password hashing
feat(chess): add legal move validation with chess.js
fix(chatbridge): handle tool invocation timeout with error injection
test(server): add auth endpoint tests with supertest
chore(prisma): add app_registrations and oauth_tokens tables
docs: update SPEC.md with completion signaling protocol
```

### Auto-Commit Behavior

After every meaningful change, commit with a conventional commit message. Run typecheck and relevant tests before committing. Do not accumulate uncommitted changes across tasks.

## Rules

- Read `chatbridge/docs/CODEBASE_ANALYSIS.md` before modifying any Chatbox source file — it maps every extension point with file paths and line numbers
- Read `chatbridge/docs/SPEC.md` for the plugin protocol, message types, and security model
- Read relevant `.claude/skills/` before using Railway, Prisma, WebSocket, or React patterns
- Follow existing Chatbox patterns: Zustand for stores, Jotai for atoms, TanStack Router for routes, react-query for server state
- All new types use Zod schemas with `z.infer<>` for TypeScript types — match Chatbox's existing pattern in `src/shared/types/`
- Validate postMessage origin on every received message — never trust `event.data` without checking `event.origin` or `event.source`
- Never send conversation history to third-party apps — only send the tool's declared parameters
- Never expose `ANTHROPIC_API_KEY` or `JWT_SECRET` to the client — these stay server-side only
- iframe sandbox: `allow-scripts` by default. Add `allow-same-origin` only for trusted self-hosted demo apps.
- Tool invocation timeout: 10 seconds default, configurable per app at registration
- Error results are injected as normal tool results — the LLM handles them conversationally
- Rate limit auth endpoints (10/min) and tool invocations (30/min per app per user)
- Use `express-rate-limit` with JWT as the rate limit key
- All database access goes through Prisma — no raw SQL
- Always use Context7 MCP to look up library/API documentation when doing code generation, setup, configuration, or referencing external dependencies — do not rely on training data for docs that may be stale
- Use sequential-thinking MCP for complex architectural decisions or multi-step debugging
- **codebase-memory-mcp workflow:** Always read `chatbridge/docs/CODEBASE_ANALYSIS.md` first. Only query codebase-memory-mcp when the question is not answered in that document — for example, tracing a call path not mapped there, finding a file added after the analysis was generated, or verifying a line number has not shifted. When you do query it, prefer `search_graph` and `trace_call_path` over reading files one by one.
