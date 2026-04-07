# ChatBridge Implementation Plan

> Generated 2026-04-02 from architecture interview. Updated with schedule, fallbacks, and deliverable tracking.
> Read SPEC.md and CODEBASE_ANALYSIS.md first; this document adds the _how_ and _in what order_.
>
> **LLM: Anthropic Claude Sonnet 4.6** (`claude-sonnet-4-6`) via `@anthropic-ai/sdk`. Single model for all calls.

---

## Day-by-Day Schedule

| Day | Date | Focus | Milestones | Deliverables Due |
|---|---|---|---|---|
| **1** | Tue | Backend scaffold + frontend wiring | M0, M1 (start) | **Tuesday MVP: pre-search PDF + architecture video + basic chat deployed** |
| **2** | Wed | Test app + iframe protocol + tool call loop | M1 (finish), M2, M3 (start) | — |
| **3** | Thu | Tool call loop + chess app | M3 (finish), M4 (start) | — |
| **4** | Fri | Chess polish + real auth + weather | M4 (finish), M5, M7 (start) | **Early submission: plugin system + chess + weather working** |
| **5** | Sat | Auth UI + weather finish + Spotify start | M6, M7 (finish), M8 (start) | — |
| **6** | Sun AM | Spotify finish + error handling + tests | M8 (finish), M9, M10 | Record demo video (not day 7) |
| **7** | Sun PM | Deploy + polish + cost analysis + video | M11 + deliverables | **Final: deployed app + video + cost analysis + social post** |

**Buffer:** Day 4 has M4+M5+M7 — if chess runs long, auth (M5) slides to day 5 and weather (M7) uses hardcoded auth. Day 7 PM is reserved for deployment and deliverables, not features.

**Auth shortcut for M0-M4:** Milestones 0 through 4 use a hardcoded JWT for testing. Real auth middleware (M5) replaces this. Do not build M0-M4 assuming auth middleware exists.

---

## Deadline Checkpoints

### Tuesday (24 hours) — Hard Gate

| Requirement | What to ship |
|---|---|
| Pre-search document | Already done (PDF submitted) |
| Architecture video (3-5 min) | Record after M0 is working. Show: architecture diagram, tech stack decisions, plugin protocol walkthrough, the generate.ts interception point |
| Basic chat working | M0 deployed to Railway: Express + Postgres + WebSocket streaming via Claude. User sends message → Claude streams response. No plugins yet. |
| Forked repo on GitLab | Push Chatbox fork with server/ directory and CLAUDE.md, SPEC.md, README.md |

### Friday (4 days) — Early Submission

| Requirement | Minimum shippable state |
|---|---|
| Full plugin system | M1-M3 complete: activate_app tool, iframe side panel, postMessage protocol, backend tool call loop |
| Multiple apps working | Chess (M4) fully playable + Weather (M7) showing forecasts. Two apps minimum |
| Auth | M5 complete: JWT endpoints work. Auth UI (M6) can be a simple form |
| Deployed | Railway deployment (M11 done early, not day 7) |
| Demo video | 3-5 min: chat + chess game + weather query + architecture explanation |

### Sunday (7 days) — Final Submission

| Requirement | What to ship |
|---|---|
| 3 working apps | Chess + Weather + Spotify (OAuth flow working) |
| Polish | Error handling (M9), loading indicators, retry buttons |
| AI cost analysis | Dev spend + projections (written day 7 — see tracking plan below) |
| Demo video | Re-record if needed (recorded day 6) |
| Social post | LinkedIn or X post with description, screenshots, @GauntletAI tag |
| Documentation | README with setup guide, architecture overview, API docs, deployed link |

---

## Fallback Plan — What to Cut

| If behind by... | Cut this | Ship this instead |
|---|---|---|
| Day 3 (chess not started) | Spotify OAuth entirely | Chess + Weather + a simple third app (e.g., calculator) |
| Day 4 (chess not done) | Spotify and error handling polish | Working chess (even if rough) + Weather. Skeleton Spotify stubbed |
| Day 5 (auth not done) | Auth UI polish | Backend auth works via curl. Frontend uses hardcoded demo token |
| Day 6 (Spotify broken) | Full Spotify | Spotify loads, shows "Connect Spotify" button, OAuth popup opens. API call stubbed |

**Minimum viable submission (worst case):** Chat works → chess full lifecycle → weather demonstrates routing → auth endpoints exist → deployed on Railway.

---

## Key Decisions (Interview Summary)

| Topic | Decision |
|---|---|
| Build order | Thin backend scaffold → vertical slice (test-app) → chess → auth UI → weather → Spotify |
| LLM provider | **Anthropic Claude Sonnet 4.6** (`claude-sonnet-4-6`) via `@anthropic-ai/sdk`. Single model for all calls — tool routing, chat, chess analysis. No model-switching logic needed. |
| WS↔postMessage handoff | Client drives continuation (multi-turn, not mid-stream hold) |
| Multi-tool sync | Collect all tool results, send batch to server in one message |
| iframe placement | Side panel (Artifact.tsx pattern). Compact inline card in chat history. |
| LLM pipeline split | Existing Chatbox pipeline untouched for normal sessions. Backend WS only for ChatBridge sessions. |
| Session activation trigger | `activate_app` tool injected at stream-text.ts:296. Executes client-side. Flips session to WS mode. |
| Railway topology | One service. Express serves SPA + demo apps at /apps/* + API. No CORS needed. |
| Sandbox | `allow-scripts` only. Sandboxed iframes get opaque `null` origin. `event.source` is primary validation. |
| OAuth token path | Stays server-side. Callback → parent → iframe gets `auth_ready` signal only. Backend makes Spotify calls. |
| App state → LLM | Client piggybacks `appContext` on every `user_message` WS payload. Backend stateless between calls. |
| Auth UX | Real auth + `POST /api/auth/demo` for friction-free grading. Seed script creates demo user. |
| History persistence | Messages in Postgres (platform contract). `restore` signal is a **stretch goal**. |
| Weather tool path | Same client→iframe round-trip as chess. Iframe fetches from `/api/internal/weather`. |

---

## Anthropic Claude API — Key Differences from OpenAI

Claude's tool use has a different wire format. These differences affect M0 and M3:

| Aspect | OpenAI | Anthropic Claude |
|---|---|---|
| SDK package | `openai` | `@anthropic-ai/sdk` |
| Env variable | `OPENAI_API_KEY` | `ANTHROPIC_API_KEY` |
| Model string | `gpt-4o-mini` | `claude-sonnet-4-6` |
| Tool schema field | `parameters` | `input_schema` |
| Tool call in response | `message.tool_calls[].function` | `content[]` blocks with `type: "tool_use"` |
| Tool result format | `{ role: "tool", tool_call_id, content }` | `{ type: "tool_result", tool_use_id, content }` inside a user message |
| Stop reason for tools | `finish_reason: "tool_calls"` | `stop_reason: "tool_use"` |
| Streaming tool calls | Accumulated from `delta.tool_calls` chunks | `content_block_start` (type=tool_use) + `input_json_delta` events |
| System prompt | `messages[0].role = "system"` | Separate `system` parameter |
| Max tokens | Optional (has default) | **Required** — must set `max_tokens` |

---

## Full Turn-by-Turn Flow (Critical Path)

```
1. User sends "let's play chess" in chat
2. Chatbox client-side pipeline runs (normal)
3. streamText at line ~296: activate_app tool is in scope
4. Claude calls activate_app({ appName: "chess" })
5. activate_app.execute():
   - Fetches chess app from chatBridgeStore registry
   - Opens WebSocket to wss://{host}/ws?token={jwt}
   - Sets chatBridgeStore.sessions[sessionId] = { active: true, apps: ['chess'] }
   - Opens ChatBridgeFrame side panel with chess iframe URL
   - Returns { status: 'activated', app: 'chess', tools: ['start_game', 'make_move', 'get_board_state'] }
6. Chatbox finishes that turn normally (Claude responds "Chess activated! Starting a game...")

--- ALL SUBSEQUENT MESSAGES GO THROUGH BACKEND WS ---

7. Claude calls start_game({ color: 'white' }) via tool_use content block
   (backend extracts tool_use block, sends { type: 'tool_call', toolCallId, toolName, params } to client)
8. Client receives tool_call, forwards to chess iframe via postMessage
9. Chess iframe: initializes game, renders board, sends tool_result back
10. Client receives tool_result (validates event.source), sends to backend via WS
11. Backend builds tool_result message for Anthropic API, calls Claude for continuation
12. Claude streams "Game started! You're playing white." → tokens flow to client
13. User drags piece → chess.js validates → app sends state_update → chatBridgeStore updates
14. User asks "what should I do?" →
    client sends WS: { type: 'user_message', content: '...', appContext: { states: { chess: { fen: '...' } } } }
15. Backend builds system prompt with FEN context → Claude analyzes → streams response
```

---

## The `generation.ts` Modification (Critical Diff)

This is the single most important change to Chatbox core code. The interception happens in `src/renderer/stores/session/generation.ts` at approximately line 110, inside the `generate()` function.

**Current code (simplified):**
```typescript
export async function generate(
  sessionId: string,
  targetMsg: Message,
  options?: { operationType?: string }
) {
  const promptMsgs = await genMessageContext(settings, messages, /* ... */)
  await streamText(model, {
    sessionId,
    messages: promptMsgs,
    onResultChange: (result) => {
      modifyMessageCache(sessionId, targetMsg, result)
    },
  })
}
```

**Modified code:**
```typescript
export async function generate(
  sessionId: string,
  targetMsg: Message,
  options?: { operationType?: string }
) {
  // === CHATBRIDGE INTERCEPTION ===
  if (chatBridgeStore.getState().isActive(sessionId)) {
    const wsClient = chatBridgeStore.getState().getWsClient()
    const appContext = chatBridgeStore.getState().getAppContext(sessionId)
    
    await wsClient.sendUserMessage({
      conversationId: sessionId,
      content: targetMsg.contentParts.find(p => p.type === 'text')?.text ?? '',
      appContext,
    }, {
      onToken: (token) => {
        modifyMessageCache(sessionId, targetMsg, { text: token, append: true })
      },
      onToolCall: async ({ toolCallId, toolName, params }) => {
        const frame = chatBridgeStore.getState().getActiveFrame(sessionId)
        const result = await frame.invokeToolAndWait(toolCallId, toolName, params)
        wsClient.sendToolResult(toolCallId, result)
      },
      onDone: () => {
        modifyMessage(sessionId, targetMsg, true, false)
      },
      onError: (msg) => {
        targetMsg.error = msg
        modifyMessage(sessionId, targetMsg, true, false)
      }
    })
    return
  }
  // === END CHATBRIDGE INTERCEPTION ===

  // ... existing Chatbox code unchanged below ...
  const promptMsgs = await genMessageContext(settings, messages, /* ... */)
  await streamText(model, { /* ... */ })
}
```

---

## Milestone 0 — Thin Backend Scaffold
**Goal:** Express + Postgres + WebSocket streaming via Anthropic Claude. One hardcoded user.
**Time:** Day 1 morning
**Auth:** Hardcoded JWT — no real auth middleware yet.

### Files to Create
| File | Purpose |
|---|---|
| `server/package.json` | express, ws, `@anthropic-ai/sdk`, @prisma/client, jsonwebtoken, bcrypt, zod |
| `server/tsconfig.json` | TypeScript strict mode, target: ES2022, outDir: dist/ |
| `server/prisma/schema.prisma` | Minimal schema: User, Conversation, Message only |
| `server/src/index.ts` | Express bootstrap, WebSocket server, static file serving |
| `server/src/ws/chatHandler.ts` | WebSocket handler: stream Anthropic response back |
| `server/src/lib/anthropic.ts` | Anthropic client singleton: `new Anthropic()` |
| `server/src/lib/prisma.ts` | Prisma client singleton |
| `server/.env.example` | `DATABASE_URL`, `ANTHROPIC_API_KEY`, `JWT_SECRET`, `PORT` |

### Anthropic client setup (`server/src/lib/anthropic.ts`)
```typescript
import Anthropic from '@anthropic-ai/sdk'

// Reads ANTHROPIC_API_KEY from process.env automatically
export const anthropic = new Anthropic()
```

### Minimal Prisma Schema
```prisma
model User {
  id           String         @id @default(uuid())
  email        String         @unique
  passwordHash String         @map("password_hash")
  createdAt    DateTime       @default(now()) @map("created_at")
  conversations Conversation[]
}

model Conversation {
  id        String    @id @default(uuid())
  userId    String    @map("user_id")
  title     String    @default("New conversation")
  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  user      User      @relation(fields: [userId], references: [id])
  messages  Message[]
}

model Message {
  id              String   @id @default(uuid())
  conversationId  String   @map("conversation_id")
  role            String
  content         String?
  toolCallId      String?  @map("tool_call_id")
  toolName        String?  @map("tool_name")
  toolParams      Json?    @map("tool_params")
  appContext      Json?    @map("app_context")
  createdAt       DateTime @default(now()) @map("created_at")
  conversation    Conversation @relation(fields: [conversationId], references: [id])

  @@index([conversationId, createdAt])
}
```

### Acceptance Criteria
- [ ] `cd server && npm run dev` starts without errors
- [ ] WebSocket connects with hardcoded token
- [ ] `{ type: 'user_message', content: 'hello' }` → Claude streams tokens back
- [ ] `npx prisma studio` shows tables
- [ ] **Deploy to Railway immediately** for Tuesday checkpoint

---

## Milestone 3 — Full Vertical Slice: Backend Tool Call Loop
**Goal:** Complete end-to-end with test app through the backend using Anthropic's tool use API.
**Time:** Day 2-3
**Depends on:** Milestones 1 and 2
**Auth:** Hardcoded JWT.

### Anthropic tool call loop (`server/src/ws/chatHandler.ts`)

```typescript
import { anthropic } from '../lib/anthropic'

async function handleUserMessage(ws, { conversationId, content, appContext }, userId) {
  const history = await loadHistory(conversationId)
  const systemPrompt = buildSystemPrompt(appContext)
  const tools = getAnthropicTools(appContext?.activeApps)

  // Stream Claude's response
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [...history, { role: 'user', content }],
    tools,
  })

  let toolUseBlocks: Array<{ id: string; name: string; input: unknown }> = []

  stream.on('text', (text) => {
    ws.send(JSON.stringify({ type: 'token', data: text }))
  })

  stream.on('contentBlock', (block) => {
    if (block.type === 'tool_use') {
      toolUseBlocks.push({ id: block.id, name: block.name, input: block.input })
    }
  })

  const finalMessage = await stream.finalMessage()

  if (finalMessage.stop_reason === 'tool_use' && toolUseBlocks.length > 0) {
    // Send each tool call to client, collect results
    const results = await Promise.all(toolUseBlocks.map(tc => {
      ws.send(JSON.stringify({
        type: 'tool_call', toolCallId: tc.id,
        toolName: tc.name, params: tc.input
      }))
      return waitForToolResult(ws, tc.id, 10_000)
    }))

    // Build continuation messages in Anthropic format
    const toolResultContent = toolUseBlocks.map((tc, i) => ({
      type: 'tool_result' as const,
      tool_use_id: tc.id,
      content: JSON.stringify(results[i])
    }))

    await persistMessages(conversationId, toolUseBlocks, results)

    // Continue: assistant message (with tool_use blocks) + user message (with tool_results)
    const continuationHistory = [
      ...history,
      { role: 'user' as const, content },
      { role: 'assistant' as const, content: finalMessage.content },
      { role: 'user' as const, content: toolResultContent }
    ]
    await handleContinuation(ws, conversationId, continuationHistory, systemPrompt, tools, userId)
    return
  }

  ws.send(JSON.stringify({ type: 'done' }))
  await persistMessages(conversationId, finalMessage)
}

// Convert tool schemas to Anthropic format
function getAnthropicTools(activeApps?: string[]) {
  return appSchemas.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters  // Same JSON Schema, different field name
  }))
}
```

### Acceptance Criteria
- [ ] "Use the dummy action" → full round-trip → Claude responds
- [ ] Multi-tool: Claude calls tools in one turn → all results collected → continuation works
- [ ] Tool timeout: 11s delay → error result → Claude responds gracefully
- [ ] Messages persisted to Postgres

---

## Milestones 1, 2, 4-11

*(Milestones 1, 2, 4 through 11 are unchanged from the previous version — only the LLM references within them change from "OpenAI" / "LLM" to "Claude" / "Anthropic". The frontend code, postMessage protocol, iframe sandboxing, auth, demo apps, deployment, and all acceptance criteria remain the same. Key substitutions throughout:)*

- `OPENAI_API_KEY` → `ANTHROPIC_API_KEY`
- `openai` package → `@anthropic-ai/sdk`
- `gpt-4o-mini` / `gpt-4o` → `claude-sonnet-4-6`
- `openai.chat.completions.create()` → `anthropic.messages.stream()`
- `finish_reason: "tool_calls"` → `stop_reason: "tool_use"`
- `message.tool_calls` → `content[] blocks with type: "tool_use"`
- Tool result format: `{ role: "tool" }` → `{ type: "tool_result", tool_use_id }` inside user message

---

## Deliverables Tracking

### AI Cost Analysis
**Track from day 1.** Use the Anthropic console (console.anthropic.com) usage dashboard.

**Claude Sonnet 4.6 pricing:** ~$3/M input tokens, ~$15/M output tokens.

| Scale | Monthly Cost | Assumptions |
|---|---|---|
| 100 users | ~$75 | 5 sessions/user/month, 10 tool invocations/session, ~2K input + 500 output tokens per invocation |
| 1,000 users | ~$650 | Same pattern, prompt caching reduces input cost by ~20% |
| 10,000 users | ~$5,500 | Aggressive context summarization saves ~30% |
| 100,000 users | ~$45,000 | Prompt caching + tool result caching |

*Note: Claude Sonnet 4.6 is more expensive per-token than GPT-4o-mini but offers stronger tool use reliability, 200K context window, and native prompt caching. Using a single model eliminates model-routing logic and simplifies cost tracking.*

Write to `chatbridge/docs/COST_ANALYSIS.md` on day 7.

### Demo Video (3-5 min)
**Record on day 6.** Cover: architecture, chess demo, weather demo, Spotify OAuth, postMessage in console, generation.ts code walkthrough.

### Social Post (Final Only)
Post on LinkedIn or X Sunday evening. Tag @GauntletAI. Link to deployed app.

---

## Stretch Goals

| Goal | Description | Milestone |
|---|---|---|
| Prompt caching | Enable Anthropic prompt caching for system prompt + tool schemas. ~90% cost reduction on cache hits. | M3 |
| `restore` signal | Send `{ type: 'restore', lastState }` to iframe on session reload. | M9 |
| Inline chat cards | Compact `[Chess — in progress]` cards in message thread. | M4 |
| Extended thinking | Use Claude's extended thinking for complex chess analysis. | M4 |

---

## Dependencies Between Milestones

```
M0 (backend scaffold) ──────────────────────────────────────────> M11 (deploy day 1)
  └─> M1 (frontend wiring + activate_app)
        └─> M2 (test-app + iframe + postMessage)
              └─> M3 (backend tool call loop)
                    ├─> M4 (chess) ──────> M7 (weather) ──> M9 (error handling)
                    ├─> M5 (auth) ──────> M6 (auth UI) ──> M8 (spotify OAuth)
                    └─> M10 (tests, parallel)

Note: M0-M4 use hardcoded JWT. M5 replaces with real auth.
```

---

## Risk Register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Anthropic streaming tool_use block accumulation | Medium | Use SDK `stream.on('contentBlock')` helper — handles accumulation. Test early in M3 |
| Anthropic tool_result format mismatch | Medium | Claude requires `tool_result` blocks with exact `tool_use_id` reference inside a `user` role message. Validate format in M3 test app |
| react-chessboard sandbox compatibility | Low | allow-scripts supports React; test early in M4 |
| Spotify OAuth popup blocked | Medium | Test on deployed URL, not localhost |
| Railway Postgres migration on deploy | Low | `prisma migrate deploy` in start command |
| Tool name collisions across apps | Low | Namespace as `{appId}_{toolName}` |
| Fall behind by day 3 | Medium | See fallback plan — cut Spotify |
| Weather iframe fetch blocked by sandbox | Low | `allow-scripts` permits fetch; test in M7 |
| Anthropic rate limits during development | Low | Sonnet tier has generous limits; monitor via console |