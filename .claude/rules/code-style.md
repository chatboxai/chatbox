# Code Style Rules

## TypeScript (Shared)

### General
- TypeScript strict mode. No `any` — use `unknown` and narrow with type guards.
- Prefer `const` over `let`. Never use `var`.
- Use explicit return types on exported functions. Inferred types are fine for internal helpers.
- Use `async/await` over raw Promises. No `.then()` chains.
- Prefer early returns over deep nesting.

### Naming
- `camelCase` for variables, functions, hooks: `chatBridgeStore`, `handleToolInvoke`, `usePluginState`.
- `PascalCase` for components, types, interfaces, Zod schemas: `ChatBridgeFrame`, `PluginManifest`, `BridgeMessageSchema`.
- `UPPER_SNAKE_CASE` for constants: `DEFAULT_TOOL_TIMEOUT`, `MAX_RETRY_COUNT`.
- Acronyms stay consistent case: `LLM`, `API`, `JWT`, `OAuth`, `SSE`, `CSP` (not `Llm`, `Api`).
- File names match primary export: `chatBridgeStore.ts`, `ChatBridgeFrame.tsx`, `tool-bridge.ts`.
- Zod schemas end in `Schema`: `PluginManifestSchema`, `BridgeMessageSchema`.
- Inferred types from Zod use same name without suffix: `type PluginManifest = z.infer<typeof PluginManifestSchema>`.

### Imports
- Order: react/hooks → third-party libraries → local components → local utils → types.
- Use named exports everywhere. Default exports only for React route components if required by TanStack Router.
- Prefer relative imports within the same package. Use `src/` paths for cross-package imports.

### Error Handling
- Always handle errors explicitly. No unhandled Promise rejections.
- Use typed error results over thrown exceptions where possible.
- Log errors with context: `console.error('tool invocation failed', { toolName, toolCallId, error })`.
- User-facing errors get friendly messages. Internal errors get detailed logging.

## React (Frontend)

### Components
- Functional components with hooks only. No class components.
- Props interfaces defined inline or co-located: `function ChatBridgeFrame({ appUrl, onReady }: Props)`.
- Destructure props in the function signature.
- Use `useRef` for iframe references and WebSocket connections.
- Use `useEffect` cleanup for event listeners and timers.

### State Management
- Follow Chatbox's existing patterns:
  - **Zustand** for global stores (`chatBridgeStore`, `settingsStore`, `uiStore`).
  - **Jotai** atoms for fine-grained reactive state.
  - **TanStack Query** for server state (conversations, messages, app registrations).
- Never introduce Redux, MobX, or other state libraries.
- Zustand store pattern:
  ```typescript
  export const chatBridgeStore = create<ChatBridgeState>((set, get) => ({
    activePlugin: null,
    setActivePlugin: (id) => set({ activePlugin: id }),
  }))
  ```
- Access outside React: `chatBridgeStore.getState()`.
- Access inside React: `const activePlugin = chatBridgeStore(s => s.activePlugin)`.

### Styling
- Tailwind utility classes. No custom CSS files unless Tailwind can't cover it.
- Avoid inline `style` props. Use Tailwind's arbitrary value syntax if needed: `w-[300px]`.
- Match Chatbox's existing design language — don't introduce new color schemes or font families.

### postMessage Communication
- Always validate `event.origin` or `event.source` before processing.
- Type all messages with a discriminated union on the `type` field.
- Use `useEffect` for `window.addEventListener('message', handler)` with cleanup in the return.
- Send to iframe: `iframeRef.current?.contentWindow?.postMessage(data, targetOrigin)`.
- Never use `'*'` as targetOrigin in production — use the registered app URL.

## Node.js / Express (Backend)

### General
- TypeScript with strict mode. Compiled with `tsc` to `dist/`.
- Use `express.json()` middleware for JSON body parsing.
- Use `cors()` middleware with explicit `CLIENT_URL` origin.
- Route handlers are thin: parse request → call service → send response. No business logic in handlers.

### Naming
- Route files: `auth.ts`, `conversations.ts`, `apps.ts`, `oauth.ts`.
- Middleware files: `auth.ts` (JWT verification), `rateLimit.ts`.
- Service files: `chatService.ts`, `appService.ts`.

### Error Handling
- Wrap async route handlers: `asyncHandler(async (req, res) => { ... })`.
- Return JSON errors: `res.status(400).json({ error: 'message' })`.
- Use proper HTTP status codes: 400 bad input, 401 unauthorized, 404 not found, 429 rate limited, 500 internal.
- Never expose stack traces, file paths, or internal error details to the client.
- Log full error details server-side with `console.error`.

### Authentication
- JWT verification middleware on all protected routes.
- Extract token from `Authorization: Bearer <token>` header or httpOnly cookie.
- Password hashing: `bcrypt` with salt rounds ≥ 10.
- Rate limit login attempts: 10 per minute per IP.

### Database (Prisma)
- All database access through Prisma client — no raw SQL.
- Use Prisma's typed query API: `prisma.message.findMany({ where: { conversationId } })`.
- Use `select` to avoid fetching unnecessary fields.
- Use transactions for multi-table operations: `prisma.$transaction([...])`.
- JSONB columns for flexible data: `tool_schemas`, `params`, `result`.

### WebSocket
- Use `ws` library on the same HTTP server: `new WebSocketServer({ server })`.
- Authenticate on connection upgrade: verify JWT from query string.
- Message protocol: `{ type: string, ...payload }` — same discriminated union pattern as postMessage.
- Handle connection close, error, and unexpected disconnect gracefully.
- Implement heartbeat ping/pong to detect dead connections.

## Third-Party Apps

### App Code Style
- Each app is a self-contained static site or SPA in `apps/<name>/`.
- Apps use vanilla JS, React, or any framework — the platform doesn't care.
- Apps must implement the postMessage protocol (see SPEC.md).
- Apps must send `{ type: 'ready' }` after iframe load.
- Apps must respond to `{ type: 'tool_invoke' }` with `{ type: 'tool_result' }`.
- Tool results must reference the correct `toolCallId`.

### Chess App Specifics
- Use `chess.js` for game logic and legal move validation.
- Use a board rendering library (e.g., `chessboard.js`, `react-chessboard`, or custom SVG).
- Store game state as FEN string. Send FEN in `state_update` messages.
- Validate moves before executing — return error result for illegal moves.

## Git Hygiene

- Never commit `.env` files, API keys, or secrets.
- Never commit `node_modules/`, `dist/`, `.tools/`.
- Run typecheck and tests before committing.
- One logical unit of work = one commit.
- Verify no secrets in staged changes:
  ```bash
  git diff --cached | grep -iE "(api_key|secret|password|token|sk-)" | grep -v "test\|mock\|example\|env\."
  ```
