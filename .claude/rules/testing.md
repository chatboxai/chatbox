# Testing Rules

## Philosophy

Test what matters for a one-week sprint graded on plugin integration quality and architectural rigor. The plugin protocol boundary is the critical path — test it thoroughly. Auth and CRUD endpoints get basic coverage. UI components get manual testing.

**Test rigorously:** postMessage protocol handling, tool schema injection, tool invocation lifecycle, auth endpoints, app registration validation, WebSocket message handling, error/timeout behavior.
**Test lightly:** Express route wiring, Prisma query correctness (trust Prisma), React component rendering.
**Don't test:** Chatbox's existing code (MCP, providers, TanStack Router), Anthropic Claude API behavior (mock it), chess.js move validation (trust the library).

## Framework & Tools

- **Backend:** Vitest (or Jest) + supertest for HTTP endpoint testing.
- **Frontend:** Vitest + React Testing Library for component tests (if time allows).
- **E2E:** Playwright MCP for full lifecycle testing (connected via `.mcp.json`).
- **Manual:** The 7 testing scenarios from the requirements doc — verified by hand against the deployed app.

## Directory Structure

```
server/
├── src/
│   └── __tests__/
│       ├── auth.test.ts              # JWT auth endpoints (register, login, refresh)
│       ├── apps.test.ts              # App registration and retrieval
│       ├── conversations.test.ts     # Conversation CRUD
│       ├── ws.test.ts                # WebSocket message handling
│       └── middleware.test.ts        # Auth middleware, rate limiting
├── test/
│   └── fixtures/
│       ├── app-registration.json     # Sample app registration payloads
│       └── tool-schemas.json         # Sample tool schema arrays

src/renderer/
├── packages/chatbridge/
│   └── __tests__/
│       ├── controller.test.ts        # Plugin lifecycle (load, getTools, timeout)
│       ├── tool-bridge.test.ts       # Schema → ToolSet conversion
│       └── message-handler.test.ts   # postMessage dispatch and validation
├── components/
│   └── __tests__/
│       └── ChatBridgeFrame.test.tsx  # iframe rendering, postMessage wiring

apps/
├── chess/
│   └── __tests__/
│       └── protocol.test.ts          # postMessage protocol compliance
└── test-app/                         # Minimal mock app for integration testing
    └── index.html                    # Implements full postMessage protocol with hardcoded responses
```

## Required Test Cases

### Auth Endpoints (Backend)

#### 1. Registration
```typescript
describe('POST /api/auth/register', () => {
  it('creates user with valid email and password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@example.com', password: 'securepass123' })
    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('token')
  })

  it('rejects duplicate email', async () => { /* 409 */ })
  it('rejects weak password', async () => { /* 400 */ })
  it('rejects invalid email format', async () => { /* 400 */ })
})
```

#### 2. Login
- Returns JWT for valid credentials.
- Returns 401 for wrong password.
- Returns 401 for nonexistent email.
- JWT contains user ID in payload.

#### 3. Token Refresh
- Returns new JWT from valid existing token.
- Returns 401 for expired token.
- Returns 401 for malformed token.

#### 4. Auth Middleware
- Passes request with valid JWT in Authorization header.
- Rejects request with missing token (401).
- Rejects request with expired token (401).
- Attaches `req.user` with decoded payload.

### App Registration (Backend)

#### 5. Register App
```typescript
describe('POST /api/apps/register', () => {
  it('registers app with valid manifest', async () => {
    const res = await request(app)
      .post('/api/apps/register')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Chess',
        url: 'https://chess.example.com',
        description: 'A chess game',
        tools: [{
          name: 'start_game',
          description: 'Start a new game',
          parameters: { type: 'object', properties: {} }
        }]
      })
    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('id')
    expect(res.body.status).toBe('pending')
  })

  it('rejects app with invalid tool schema', async () => { /* 400 */ })
  it('rejects app with missing required fields', async () => { /* 400 */ })
  it('requires authentication', async () => { /* 401 */ })
})
```

#### 6. List Approved Apps
- Returns only apps with `status: 'approved'`.
- Excludes pending and rejected apps.
- Includes tool schemas in response.

#### 7. Update App Status (Admin)
- Changes status from pending to approved.
- Changes status from approved to rejected.

### Conversation CRUD (Backend)

#### 8. Create and Retrieve Conversation
- POST creates conversation, returns ID.
- GET returns conversation with messages.
- Messages are ordered by `created_at`.

#### 9. Message Persistence
- Messages survive server restart (in Postgres, not in memory).
- Tool call/result messages stored with `tool_call_id`, `tool_name`, `tool_params`.

### Plugin Protocol (Frontend)

#### 10. postMessage Validation
```typescript
describe('message handler', () => {
  it('processes tool_result from valid iframe source', () => { /* ... */ })
  it('ignores messages from unknown origins', () => { /* ... */ })
  it('ignores messages without a type field', () => { /* ... */ })
  it('ignores messages with unknown type', () => { /* ... */ })
  it('ignores messages from non-iframe sources', () => { /* ... */ })
})
```

#### 11. Tool Schema Conversion
```typescript
describe('tool-bridge', () => {
  it('converts plugin manifest tools to AI SDK ToolSet format', () => {
    const manifest = {
      tools: [{
        name: 'make_move',
        description: 'Make a chess move',
        parameters: {
          type: 'object',
          properties: { from: { type: 'string' }, to: { type: 'string' } },
          required: ['from', 'to']
        }
      }]
    }
    const toolSet = convertToToolSet(manifest)
    expect(toolSet).toHaveProperty('make_move')
    expect(toolSet.make_move.description).toBe('Make a chess move')
    expect(toolSet.make_move.execute).toBeInstanceOf(Function)
  })
})
```

#### 12. Tool Invocation Timeout
```typescript
describe('tool invocation', () => {
  it('resolves on tool_result received within timeout', async () => { /* ... */ })
  it('rejects with timeout error after 10 seconds', async () => { /* ... */ })
  it('returns error result object, not thrown exception', async () => { /* ... */ })
})
```

#### 13. Completion Signaling
- App sends `{ type: 'completion', result }` → chatBridgeStore updates.
- Platform inserts summary message into conversation.
- App tools are optionally removed from active tool set.

#### 14. Circuit Breaker
- After 3 consecutive failures, app tools are removed from the tool set.
- User is informed the app is unavailable.

### WebSocket (Backend)

#### 15. Connection Authentication
```typescript
describe('WebSocket', () => {
  it('accepts connection with valid JWT in query string', () => { /* ... */ })
  it('rejects connection without JWT', () => { /* close with 4001 */ })
  it('rejects connection with expired JWT', () => { /* close with 4001 */ })
})
```

#### 16. Message Handling
- Receives `user_message` → stores in DB → calls Anthropic Claude → streams `token` events back.
- Handles `tool_call` in LLM response → forwards to client.
- Handles connection drop mid-stream gracefully.

### Third-Party App Protocol Compliance

#### 17. Test App (Mock)
Build a minimal static HTML page (`apps/test-app/index.html`) that:
- Sends `{ type: 'ready' }` on load.
- Sends `{ type: 'register_tools' }` with one tool.
- Responds to `{ type: 'tool_invoke' }` with `{ type: 'tool_result' }` using the correct `toolCallId`.
- Sends `{ type: 'state_update' }` on a timer.
- Sends `{ type: 'completion' }` after 3 invocations.

This test app validates the platform side of the protocol without depending on real app logic.

#### 18. Chess App Protocol
- Sends `ready` on load.
- Registers tools: `start_game`, `make_move`, `get_board_state`.
- Responds to `start_game` with initial board FEN.
- Responds to `make_move` with updated FEN or error for illegal moves.
- Sends `state_update` after each move.
- Sends `completion` on checkmate/stalemate/resignation.

## E2E Testing (Playwright)

Use the Playwright MCP to test the 7 scenarios from the requirements:

1. User asks chatbot to use a third-party app → app loads in iframe.
2. App UI renders correctly within the chat.
3. User interacts with app, then returns to chatbot → completion signal received.
4. User asks about app results after completion → LLM references the interaction.
5. User switches between multiple apps in same conversation.
6. Ambiguous question that could map to multiple apps → LLM picks the right one.
7. Unrelated query → chatbot does not invoke any app tools.

These are manual-first for the sprint, automated if time allows.

## Mocking Strategy

### Anthropic Claude API Mock
```typescript
// Mock the Anthropic client for unit tests
const mockAnthropic = {
  messages: {
    stream: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      finalMessage: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Hello!' }],
        stop_reason: 'end_turn'
      })
    }),
    create: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Hello!' }],
      stop_reason: 'end_turn'
    })
  }
}
```

For tool use responses, mock returns `tool_use` content blocks and `stop_reason: 'tool_use'`:
```typescript
mockStream.finalMessage.mockResolvedValueOnce({
  content: [
    {
      type: 'tool_use',
      id: 'toolu_123',
      name: 'start_game',
      input: { color: 'white' }
    }
  ],
  stop_reason: 'tool_use'
})
```

### Database Mock
Use Prisma's built-in testing utilities or an in-memory SQLite database for fast tests:
```typescript
beforeEach(async () => {
  await prisma.message.deleteMany()
  await prisma.conversation.deleteMany()
  await prisma.user.deleteMany()
})
```

Or use `vitest-mock-extended` to mock the Prisma client entirely for unit tests that don't need real DB.

## What Not to Test

- Don't test Chatbox's existing MCP integration, provider system, or TanStack Router — they work.
- Don't test `chess.js` move validation — trust the library.
- Don't test Anthropic's tool use behavior — mock it.
- Don't test Prisma's query correctness — trust the ORM.
- Don't test `bcrypt` hashing — trust the library.
- Don't test WebSocket protocol compliance — trust `ws`.
- Don't aim for 100% coverage — aim for "the plugin protocol works end-to-end, auth is secure, and errors are handled gracefully."
