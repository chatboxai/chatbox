# API Contracts & Schemas

## General Principles

- The Express backend serves a REST API for the React frontend and handles WebSocket connections for real-time chat.
- All request/response bodies are JSON. All timestamps are ISO 8601 format.
- Authentication via JWT in `Authorization: Bearer <token>` header or httpOnly cookie.
- Database access exclusively through Prisma — all types are derived from the Prisma schema.
- Anthropic API calls happen server-side only. The client never sees the API key.

## Database Schema (Prisma)

```prisma
model User {
  id           String         @id @default(uuid())
  email        String         @unique
  passwordHash String         @map("password_hash")
  createdAt    DateTime       @default(now()) @map("created_at")
  conversations Conversation[]
  oauthTokens  OAuthToken[]
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
  role            String   // 'user' | 'assistant' | 'system' | 'tool'
  content         String?
  toolCallId      String?  @map("tool_call_id")
  toolName        String?  @map("tool_name")
  toolParams      Json?    @map("tool_params")
  createdAt       DateTime @default(now()) @map("created_at")
  conversation    Conversation @relation(fields: [conversationId], references: [id])

  @@index([conversationId, createdAt])
}

model AppRegistration {
  id          String   @id @default(uuid())
  name        String
  url         String
  description String
  toolSchemas Json     @map("tool_schemas") // Array of tool definitions
  status      String   @default("pending")  // 'pending' | 'approved' | 'rejected'
  createdAt   DateTime @default(now()) @map("created_at")
  toolInvocations ToolInvocation[]
}

model OAuthToken {
  id           String   @id @default(uuid())
  userId       String   @map("user_id")
  provider     String   // 'spotify' | 'github' | etc.
  accessToken  String   @map("access_token")
  refreshToken String?  @map("refresh_token")
  expiresAt    DateTime? @map("expires_at")
  user         User     @relation(fields: [userId], references: [id])

  @@unique([userId, provider])
}

model ToolInvocation {
  id             String   @id @default(uuid())
  conversationId String   @map("conversation_id")
  appId          String   @map("app_id")
  toolName       String   @map("tool_name")
  params         Json
  result         Json?
  durationMs     Int?     @map("duration_ms")
  status         String   @default("pending") // 'pending' | 'success' | 'error' | 'timeout'
  createdAt      DateTime @default(now()) @map("created_at")
  app            AppRegistration @relation(fields: [appId], references: [id])
}
```

## REST API Endpoints

### Authentication

#### Register
```
POST /api/auth/register
Content-Type: application/json

Request:
{
  "email": "student@school.edu",
  "password": "securepass123"
}

Response 201:
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": "uuid", "email": "student@school.edu" }
}

Response 400: { "error": "Email already registered" }
Response 400: { "error": "Password must be at least 8 characters" }
```

#### Login
```
POST /api/auth/login
Content-Type: application/json

Request:
{ "email": "student@school.edu", "password": "securepass123" }

Response 200:
{ "token": "eyJhbGciOiJIUzI1NiIs...", "user": { "id": "uuid", "email": "..." } }

Response 401: { "error": "Invalid credentials" }
```

#### Refresh Token
```
POST /api/auth/refresh
Authorization: Bearer <existing-token>

Response 200: { "token": "eyJhbGciOiJIUzI1NiIs..." }
Response 401: { "error": "Token expired" }
```

### Conversations

#### List Conversations
```
GET /api/conversations
Authorization: Bearer <token>

Response 200:
{
  "conversations": [
    { "id": "uuid", "title": "Chess game", "updatedAt": "2026-04-01T..." }
  ]
}
```

#### Get Conversation with Messages
```
GET /api/conversations/:id
Authorization: Bearer <token>

Response 200:
{
  "id": "uuid",
  "title": "Chess game",
  "messages": [
    { "id": "uuid", "role": "user", "content": "let's play chess", "createdAt": "..." },
    { "id": "uuid", "role": "assistant", "content": "Starting a game!", "toolCallId": "call_123", "toolName": "start_game", "createdAt": "..." }
  ]
}

Response 404: { "error": "Conversation not found" }
```

#### Create Conversation
```
POST /api/conversations
Authorization: Bearer <token>

Response 201: { "id": "uuid", "title": "New conversation" }
```

#### Delete Conversation
```
DELETE /api/conversations/:id
Authorization: Bearer <token>

Response 204 (no body)
Response 404: { "error": "Conversation not found" }
```

### App Registry

#### List Approved Apps
```
GET /api/apps
Authorization: Bearer <token>

Response 200:
{
  "apps": [
    {
      "id": "uuid",
      "name": "Chess",
      "url": "https://chess-app.railway.app",
      "description": "Interactive chess game",
      "toolSchemas": [
        { "name": "start_game", "description": "...", "parameters": {...} },
        { "name": "make_move", "description": "...", "parameters": {...} }
      ]
    }
  ]
}
```

#### Register App
```
POST /api/apps/register
Authorization: Bearer <token>
Content-Type: application/json

Request:
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
          "color": { "type": "string", "enum": ["white", "black"], "description": "Player color" }
        }
      }
    }
  ]
}

Response 201: { "id": "uuid", "status": "pending" }
Response 400: { "error": "Invalid tool schema" }
```

#### Update App Status
```
PATCH /api/apps/:id/status
Authorization: Bearer <admin-token>
Content-Type: application/json

Request: { "status": "approved" }
Response 200: { "id": "uuid", "status": "approved" }
```

### OAuth

#### Initiate OAuth Flow
```
GET /api/oauth/:provider/authorize
Authorization: Bearer <token>

Redirects to provider's auth page (e.g., accounts.spotify.com/authorize)
Query params: client_id, redirect_uri, scope, state (CSRF token)
```

#### OAuth Callback
```
GET /api/oauth/:provider/callback?code=AUTH_CODE&state=CSRF_TOKEN

Server-side:
1. Validates state param matches stored CSRF token
2. Exchanges code for access_token + refresh_token
3. Stores tokens in oauth_tokens table
4. Renders HTML page that calls:
   window.opener.postMessage({ type: 'oauth_complete', provider: 'spotify' }, CLIENT_URL)
   window.close()
```

## WebSocket Protocol

Connect: `ws://host:port/ws?token=JWT_TOKEN`

### Client → Server Messages

#### Send User Message
```json
{
  "type": "user_message",
  "conversationId": "uuid",
  "content": "let's play chess"
}
```

### Server → Client Messages

#### Streamed Token
```json
{ "type": "token", "data": "Here" }
```

#### Tool Call (LLM wants to invoke a tool)
```json
{
  "type": "tool_call",
  "toolCallId": "call_abc123",
  "toolName": "start_game",
  "params": { "color": "white" }
}
```

#### Tool Result Needed (client must forward to iframe and return result)
```json
{
  "type": "tool_result_needed",
  "toolCallId": "call_abc123"
}
```

#### Generation Complete
```json
{ "type": "done" }
```

#### Error
```json
{ "type": "error", "message": "Generation failed. Please try again." }
```

## postMessage Protocol (Browser-Side)

### Platform → App (iframe)

#### Tool Invocation
```json
{
  "type": "tool_invoke",
  "toolCallId": "call_abc123",
  "toolName": "start_game",
  "params": { "color": "white" }
}
```

#### Auth Token Available
```json
{
  "type": "auth_token",
  "token": "spotify_access_token_here",
  "provider": "spotify"
}
```

### App (iframe) → Platform

#### Ready Signal
```json
{ "type": "ready" }
```

#### Register/Update Tools
```json
{
  "type": "register_tools",
  "schemas": [
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
    }
  ]
}
```

#### Tool Result
```json
{
  "type": "tool_result",
  "toolCallId": "call_abc123",
  "result": {
    "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
    "message": "Game started. You're playing white. Your move!"
  }
}
```

#### State Update
```json
{
  "type": "state_update",
  "state": {
    "fen": "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2",
    "moveCount": 2,
    "lastMove": "e7e5",
    "turn": "white"
  }
}
```

#### Completion Signal
```json
{
  "type": "completion",
  "result": {
    "outcome": "checkmate",
    "winner": "white",
    "totalMoves": 24,
    "summary": "White won by checkmate after 24 moves"
  }
}
```

## Anthropic Claude API Integration

**SDK:** `@anthropic-ai/sdk`. **Model:** `claude-sonnet-4-6`. **Env var:** `ANTHROPIC_API_KEY`.

Key differences from OpenAI API that affect all backend code:
- System prompt is a **separate `system` parameter**, not a message in the array
- Tool schemas use `input_schema` (not `parameters`) in the Anthropic API call
- Tool calls in responses are `content[]` blocks with `type: "tool_use"` (not `message.tool_calls`)
- Tool results are `{ type: "tool_result", tool_use_id, content }` inside a **user** role message
- Stop reason for tool use is `stop_reason: "tool_use"` (not `finish_reason: "tool_calls"`)
- `max_tokens` is **required** (e.g. `4096`) — no default
- Internal tool schemas (stored in DB, used in code) keep `parameters` field name; only convert to `input_schema` when calling the Anthropic API

### Chat Completion with Tools

```typescript
import { anthropic } from '../lib/anthropic'

const stream = anthropic.messages.stream({
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,
  system: `You are a helpful AI assistant on an educational platform.
Active apps: Chess (game in progress, FEN: ${currentFen}, ${moveCount} moves played, user playing white).
Available tools allow you to interact with these apps.`,
  messages: [
    ...conversationHistory,
    { role: 'user', content: userMessage }
  ],
  tools: [
    {
      name: 'start_game',
      description: 'Start a new chess game',
      input_schema: {         // NOTE: input_schema (not parameters) for Anthropic API
        type: 'object',
        properties: {
          color: { type: 'string', enum: ['white', 'black'] }
        }
      }
    },
    // ... more tools from active apps
  ],
})
```

### Streaming Response Handling

```typescript
let toolUseBlocks: Array<{ id: string; name: string; input: unknown }> = []

stream.on('text', (text) => {
  // Stream text token to client via WebSocket
  ws.send(JSON.stringify({ type: 'token', data: text }))
})

stream.on('contentBlock', (block) => {
  if (block.type === 'tool_use') {
    toolUseBlocks.push({ id: block.id, name: block.name, input: block.input })
  }
})

const finalMessage = await stream.finalMessage()

if (finalMessage.stop_reason === 'tool_use' && toolUseBlocks.length > 0) {
  // Send tool calls to client, wait for results (see chatHandler.ts)
  for (const tc of toolUseBlocks) {
    ws.send(JSON.stringify({
      type: 'tool_call',
      toolCallId: tc.id,
      toolName: tc.name,
      params: tc.input
    }))
  }
  // ... collect results, build continuation (see IMPLEMENTATION_PLAN.md M3)
}

ws.send(JSON.stringify({ type: 'done' }))
```

### Tool Result Format (Anthropic-specific)

Tool results must be sent as `tool_result` content blocks inside a **user** role message, not as a separate `tool` role:

```typescript
// Continuation call after tool results are collected:
const continuationMessages = [
  ...previousHistory,
  { role: 'user' as const, content: userMessage },
  { role: 'assistant' as const, content: finalMessage.content },  // includes tool_use blocks
  {
    role: 'user' as const,
    content: toolUseBlocks.map((tc, i) => ({
      type: 'tool_result' as const,
      tool_use_id: tc.id,                    // NOTE: tool_use_id (not tool_call_id)
      content: JSON.stringify(toolResults[i])
    }))
  }
]
```

## Tool Schema Format

Tool schemas follow JSON Schema draft-07. Our internal format (DB storage, Zod types, postMessage protocol) uses `parameters`. When calling the Anthropic API, convert to `input_schema`:

```json
{
  "name": "make_move",
  "description": "Make a chess move by specifying the source and destination squares",
  "parameters": {
    "type": "object",
    "properties": {
      "from": {
        "type": "string",
        "description": "Source square in algebraic notation (e.g., 'e2')"
      },
      "to": {
        "type": "string",
        "description": "Destination square in algebraic notation (e.g., 'e4')"
      },
      "promotion": {
        "type": "string",
        "enum": ["q", "r", "b", "n"],
        "description": "Piece to promote to (only for pawn promotion)"
      }
    },
    "required": ["from", "to"]
  }
}
```

## Zod Schemas (TypeScript Types)

```typescript
// src/shared/types/chatbridge.ts

import { z } from 'zod'

export const ToolSchemaSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.unknown()), // JSON Schema object
})

export const PluginManifestSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  url: z.string().url(),
  description: z.string(),
  tools: z.array(ToolSchemaSchema),
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  authRequired: z.boolean().default(false),
  authProvider: z.string().optional(),
})

export const BridgeMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('register_tools'), schemas: z.array(ToolSchemaSchema) }),
  z.object({ type: z.literal('tool_invoke'), toolCallId: z.string(), toolName: z.string(), params: z.record(z.unknown()) }),
  z.object({ type: z.literal('tool_result'), toolCallId: z.string(), result: z.unknown() }),
  z.object({ type: z.literal('state_update'), state: z.record(z.unknown()) }),
  z.object({ type: z.literal('completion'), result: z.unknown() }),
  z.object({ type: z.literal('auth_token'), token: z.string(), provider: z.string() }),
])

export type ToolSchema = z.infer<typeof ToolSchemaSchema>
export type PluginManifest = z.infer<typeof PluginManifestSchema>
export type BridgeMessage = z.infer<typeof BridgeMessageSchema>
```
