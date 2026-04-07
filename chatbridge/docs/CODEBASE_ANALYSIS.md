# Chatbox Codebase Analysis

> Generated 2026-04-02 via `codebase-memory-mcp` graph queries (18,939 nodes, 24,887 edges).  
> This document is authoritative for future Claude Code sessions — do not re-query the graph for any
> structural question answered here.

---

## 1. Project Overview

Chatbox Community Edition is a multi-platform AI chat application built on a single React/TypeScript codebase that compiles to three targets:

| Target | Runtime | Entry |
|---|---|---|
| Desktop | Electron 26 | `src/main/main.ts` + `src/renderer/index.tsx` |
| Mobile (iOS/Android) | Capacitor 7 | `src/renderer/index.tsx` (web view) |
| Web | Vite SPA | `src/renderer/index.tsx` |

All UI code lives in `src/renderer/`. Business logic shared across targets lives in `src/shared/`. The Electron main process lives in `src/main/` and bridges native APIs to the renderer via IPC.

Unique characteristics:
- **30+ LLM providers** via a declarative registry (`defineProvider` pattern)
- **AI SDK v6** (`ai`, `@ai-sdk/*`) as the unified streaming layer
- **MCP (Model Context Protocol)** for extensible tool use
- Artifact iframe preview (`Artifact.tsx`) for sandboxed HTML/JS rendering
- Context compaction/summarization before hitting the model's token limit

---

## 2. Directory Structure

```
chatbox/
├── src/
│   ├── main/               # Electron main process
│   │   ├── main.ts         # Entry: Electron app bootstrap, IPC handlers, BrowserWindow
│   │   ├── store-node.ts   # electron-store (persistent settings on disk)
│   │   ├── mcp/            # Main-process MCP stdio transport (IPC bridge for MCP)
│   │   └── knowledge-base/ # Document parsing pipeline (local/MinerU/Chatbox-AI)
│   ├── preload/            # Electron preload scripts — exposes electronAPI on window
│   ├── renderer/           # React frontend (shared by all targets)
│   │   ├── index.tsx       # Renderer entry: init, ReactDOM.render, RouterProvider
│   │   ├── router.tsx      # TanStack Router config
│   │   ├── routes/         # File-based routing (TanStack Router)
│   │   │   ├── __root.tsx  # Root layout component
│   │   │   ├── chat/       # Main chat UI
│   │   │   ├── settings/   # Settings pages (providers, MCP, etc.)
│   │   │   └── image-creator/ # Image generation route
│   │   ├── components/     # Shared UI components
│   │   │   ├── Artifact.tsx       # iframe-based HTML preview component
│   │   │   ├── chat/              # MessageList, MessageItem, etc.
│   │   │   └── InputBox/          # User input + file attachment
│   │   ├── stores/         # State management
│   │   │   ├── chatStore.ts       # react-query-backed session/message CRUD
│   │   │   ├── settingsStore.ts   # Zustand: settings persistence
│   │   │   ├── uiStore.ts         # Zustand: UI state (sidebar, modals)
│   │   │   ├── taskSessionStore.ts # Zustand: task (agent) sessions
│   │   │   ├── atoms/             # Jotai atoms (fine-grained reactive state)
│   │   │   └── session/           # Session action modules
│   │   │       ├── messages.ts    # submitNewUserMessage
│   │   │       └── generation.ts  # generate, generateMore, genMessageContext
│   │   ├── packages/       # Pure logic packages
│   │   │   ├── model-calls/       # Core LLM call layer
│   │   │   │   ├── stream-text.ts # streamText — main chat generation fn
│   │   │   │   ├── message-utils.ts # injectModelSystemPrompt, sequenceMessages
│   │   │   │   └── toolsets/      # web-search, knowledge-base, file toolsets
│   │   │   ├── mcp/               # MCP client (renderer-side)
│   │   │   │   ├── controller.ts  # MCPServer class + mcpController singleton
│   │   │   │   └── ipc-stdio-transport.ts
│   │   │   ├── context-management/ # Token counting, compaction, summarization
│   │   │   │   ├── compaction.ts  # runCompactionWithUIState
│   │   │   │   └── summary-generator.ts
│   │   │   └── token-estimation/  # estimateTokens, ComputationQueue
│   │   ├── platform/       # Platform abstraction layer
│   │   │   ├── index.ts           # exports `platform` singleton
│   │   │   ├── desktop_platform.ts # DesktopPlatform
│   │   │   ├── web_platform.ts    # WebPlatform
│   │   │   ├── storages.ts        # DesktopFileStorage, IndexedDBStorage, SQLiteStorage
│   │   │   └── interfaces.ts      # Storage interface
│   │   └── storage/        # StorageKey enum, StoreStorage, BaseStorage
│   └── shared/             # Code used by both main and renderer
│       ├── types/
│       │   ├── session.ts  # Message, Session, MessageContentPart Zod schemas
│       │   ├── settings.ts # Settings, SessionSettings, ProviderSettings schemas
│       │   └── provider.ts # ModelProviderEnum
│       ├── providers/
│       │   ├── registry.ts # defineProvider, providerRegistry Map
│       │   ├── index.ts    # getModel, getModelConfig
│       │   └── definitions/models/ # One file per provider (openai.ts, claude.ts, …)
│       └── models/
│           └── abstract-ai-sdk.ts # AbstractAISDKModel base class
├── chatbridge/             # ChatBridge plugin work (Week 7)
│   └── docs/               # This directory
├── docs/                   # Project documentation
└── test/                   # Integration tests
    └── integration/        # file-conversation tests with real model calls
```

---

## 3. Tech Stack

| Layer | Library | Version |
|---|---|---|
| UI Framework | React | 18.x |
| Desktop Runtime | Electron | 26.x |
| Mobile Runtime | Capacitor | 7.x |
| Bundler (renderer) | Vite + electron-vite | 7.x / 4.x |
| Router | TanStack Router | 1.x (file-based) |
| Server State | TanStack Query | 5.x |
| Global State | Zustand | 5.x |
| Atom State | Jotai | 2.x |
| Styling | Tailwind CSS | 3.x |
| AI SDK | Vercel `ai` | 6.x |
| Provider SDKs | `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, etc. | 3.x each |
| MCP Client | `@ai-sdk/mcp` | 1.x |
| Schema Validation | Zod | 4.x |
| Linter/Formatter | Biome | 2.x |
| Testing | Vitest | 4.x |
| Storage (desktop) | electron-store (node) | 8.x |
| Storage (web/mobile) | localforage / IndexedDB | — |
| Storage (mobile) | `@capacitor-community/sqlite` | 7.x |
| Error Monitoring | Sentry | 10.x |
| i18n | i18next + react-i18next | 22.x / 12.x |

---

## 4. Entry Points & Bootstrap

### Electron Main Process

**File:** `src/main/main.ts`

1. `app.whenReady()` fires
2. Creates `BrowserWindow`, registers IPC handlers (file parsing, store access, MCP stdio)
3. Loads renderer URL (dev: Vite dev server; prod: `dist/renderer/index.html`)
4. Knowledge base initialized lazily: `import('./knowledge-base/index.js').then(mod => mod.getInitPromise())`

### Renderer (shared by all targets)

**File:** `src/renderer/index.tsx`

```
initializeApp()
  ├── initSettingsStore()        — loads settings from platform storage
  ├── migration.run()            — schema migrations
  ├── initLastUsedModelStore()   — caches last model selection
  └── ReactDOM.createRoot().render(
        <RouterProvider router={router} />   ← TanStack Router
      )
```

The router is defined in `src/renderer/router.tsx`. The root layout component is `src/renderer/routes/__root.tsx` (`Root` function, 28 callees — sets up providers, sidebar, modal system).

### Web Build

Uses the same `src/renderer/index.tsx`. Platform-specific code is gated by `CHATBOX_BUILD_TARGET` and `CHATBOX_BUILD_PLATFORM` env vars set by electron-vite.

---

## 5. Data Schema

All core types are Zod schemas in `src/shared/types/session.ts` and `src/shared/types/settings.ts`. TypeScript types are derived via `z.infer<>`.

### Message (`src/shared/types/session.ts:312`)

```typescript
type Message = {
  id: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  name?: string
  cancel?: () => void               // live abort fn, stripped before persist
  generating?: boolean
  aiProvider?: string
  model?: string
  files?: MessageFile[]             // attached files (storageKey → IndexedDB blob)
  links?: MessageLink[]             // attached URLs
  contentParts: MessageContentPart[] // text | image | info | reasoning | tool-call
  reasoningContent?: string         // deprecated, moved to contentParts
  error?: string
  errorCode?: number
  errorExtra?: { aiProvider, host, responseBody }
  status?: MessageStatus[]          // sending_file | loading_webpage | retrying
  tokensUsed?: number
  usage?: { inputTokens, outputTokens, totalTokens, reasoningTokens, cachedInputTokens }
  finishReason?: string
  firstTokenLatency?: number
  isStreamingMode?: boolean
  compactionPoint?: boolean         // marks where context was summarized
}

type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; storageKey: string; ocrResult?: string }
  | { type: 'info'; text: string; values?: Record<string, unknown> }
  | { type: 'reasoning'; text: string; startTime?: number; duration?: number }
  | { type: 'tool-call'; state: 'call'|'result'|'error'; toolCallId: string;
      toolName: string; args: unknown; result?: unknown }
```

### Session (`src/shared/types/session.ts:315`)

```typescript
type Session = {
  id: string
  type?: 'chat' | 'picture'
  name: string
  messages: Message[]
  threads?: SessionThread[]          // branching conversations
  compactionPoints?: CompactionPoint[]
  // + all SessionSettings fields merged in
}
```

### Settings (`src/shared/types/settings.ts:406`)

The top-level `Settings` type contains all persisted user preferences. Key sub-types:

```typescript
type SessionSettings = {
  provider: string            // ModelProviderEnum or custom provider id
  modelId: string
  stream?: boolean
  temperature?: number
  maxTokens?: number
  systemMessage?: string
  providerOptions?: ProviderOptions  // Claude/OpenAI/Google-specific params
  // ... more
}

type ProviderSettings = {
  apiKey?: string
  apiHost?: string
  apiPath?: string
  models?: ProviderModelInfo[]
  oauth?: OAuthCredentials
  // ... Azure, proxy, etc.
}
```

**Schema files:**
- Session types: `src/shared/types/session.ts`
- Settings types: `src/shared/types/settings.ts`
- Provider enum: `src/shared/types/provider.ts`

---

## 6. Chat Message Flow

Full path from user keystroke to rendered streamed response:

```
[User presses Enter in InputBox]
    src/renderer/components/InputBox/InputBox.tsx
        ↓  calls
submitNewUserMessage(sessionId, { newUserMsg, needGenerating })
    src/renderer/stores/session/messages.ts:111
        │
        ├── runCompactionWithUIState(sessionId)   ← blocking, may summarize history
        │     src/renderer/packages/context-management/compaction.ts:124
        │
        ├── insertMessage(sessionId, newUserMsg)  ← persists user message
        │
        ├── insertMessage(sessionId, newAssistantMsg)  ← placeholder with generating=true
        │
        └── generate(sessionId, newAssistantMsg, { operationType: 'send_message' })
                src/renderer/stores/session/generation.ts:110
                    │
                    ├── genMessageContext(settings, messages, …)
                    │     → builds promptMsgs slice (respects compaction points)
                    │       src/renderer/stores/session/generation.ts:379
                    │
                    └── streamText(model, { sessionId, messages: promptMsgs, … })
                              src/renderer/packages/model-calls/stream-text.ts:125
                                  │
                                  ├── injectModelSystemPrompt(modelId, messages, toolSetInstructions)
                                  │     → prepends "Current model / date / additional info" to
                                  │       first system message
                                  │       src/renderer/packages/model-calls/message-utils.ts:119
                                  │
                                  ├── sequenceMessages(messages)   ← fix role ordering
                                  │
                                  ├── convertToModelMessages(messages, …)  ← AI SDK format
                                  │
                                  ├── [build ToolSet]
                                  │     mcpController.getAvailableTools()   +  web_search
                                  │     + kbToolSet.tools  +  fileToolSet.tools
                                  │
                                  └── model.chat(coreMessages, { tools, onResultChange, … })
                                            ↓ (AbstractAISDKModel.chat())
                                        @ai-sdk streamText() → provider API (OpenAI/Anthropic/…)
                                            ↓ streaming chunks
                                        onResultChange({ contentParts, … })  ← called per chunk
                                            ↓
                                        modifyMessage(sessionId, targetMsg, false, true)
                                            ↓  (throttled, every 2s persisted to storage)
                                        React re-render via react-query cache invalidation
```

**Key file:line anchors:**

| Step | File | Line |
|---|---|---|
| `submitNewUserMessage` | `src/renderer/stores/session/messages.ts` | 111 |
| `generate` | `src/renderer/stores/session/generation.ts` | 110 |
| `genMessageContext` | `src/renderer/stores/session/generation.ts` | 379 |
| `streamText` | `src/renderer/packages/model-calls/stream-text.ts` | 125 |
| `injectModelSystemPrompt` | `src/renderer/packages/model-calls/message-utils.ts` | 119 |
| Tool set assembly | `src/renderer/packages/model-calls/stream-text.ts` | 296 |
| `model.chat()` call | `src/renderer/packages/model-calls/stream-text.ts` | 319 |

---

## 7. LLM / AI Call Pipeline

### streamText (`src/renderer/packages/model-calls/stream-text.ts:125`)

The central function that handles all chat generation. It:

1. **Detects capabilities** — checks `model.isSupportToolUse()`, `isSupportVision()`, `isSupportSystemMessage()`
2. **Loads toolsets asynchronously** — knowledge base toolset (`getToolSet`), file toolset, web search toolset
3. **Injects system prompt** via `injectModelSystemPrompt`:
   ```
   "Current model: {modelId}\nCurrent date: {YYYY-MM-DD}\nAdditional info: {toolSetInstructions}\n\n{original system message}"
   ```
   Injected into the first `system` role message (or first `user` if model doesn't support system messages).
4. **Falls back to prompt engineering** — if model doesn't support tool use but KB/web is enabled, uses `knowledgeBaseSearchByPromptEngineering` / `searchByPromptEngineering`
5. **Assembles ToolSet** (line 296):
   ```typescript
   let tools: ToolSet = { ...mcpController.getAvailableTools() }
   if (webBrowsing) tools.web_search = webSearchTool
   if (kbToolSet)   tools = { ...tools, ...kbToolSet.tools }
   if (needFileToolSet) tools = { ...tools, ...fileToolSet.tools }
   ```
6. **Calls `model.chat()`** — delegates to the provider's `AbstractAISDKModel.chat()` which wraps `ai.streamText()`
7. **Streams results** — `onResultChange` is called per chunk; caller (`generate`) batches writes to storage every 2 seconds

### message-utils.ts (`src/renderer/packages/model-calls/message-utils.ts:119`)

`injectModelSystemPrompt(model, messages, additionalInfo, role='system')`:
- Finds the first message with matching `role`
- Prepends `metadataPrompt` to its text content
- Returns mutated message array (clones the affected message to avoid mutating shared refs)

### AbstractAISDKModel (`src/shared/models/abstract-ai-sdk.ts`)

All provider model classes extend this. It wraps the Vercel AI SDK's `streamText()` / `generateText()` and handles:
- Retry logic (via `ai-retry`)
- Tool call loop (multi-turn tool execution)
- Response streaming back via `onResultChange` callback

---

## 8. Storage & Persistence

### Platform Storage Abstraction

**Interface:** `src/renderer/platform/interfaces.ts` (`Storage` interface)  
**Implementations:** `src/renderer/platform/storages.ts`

| Class | Platform | Backing Store |
|---|---|---|
| `DesktopFileStorage` | Electron desktop | `electron-store` (JSON file on disk) via IPC |
| `IndexedDBStorage` | Web / Capacitor | `localforage` → IndexedDB |
| `SQLiteStorage` | Capacitor (better-sqlite3) | `@capacitor-community/sqlite` |
| `LocalStorage` | Legacy web (pre-v6) | `window.localStorage` |

The `platform` singleton in `src/renderer/platform/index.ts` exports the right storage implementation for the current target.

### Session / Message Persistence

Sessions and messages are stored as JSON blobs under `StorageKey.ChatSessions`. The `chatStore.ts` uses **TanStack Query** as an in-memory cache on top of storage:
- Reads: `queryClient.fetchQuery(['chat-session', id])`
- Writes: `modifyMessage()` → `UpdateQueue` → batched writes to `storage.setStoreValue()`
- Throttled atom (`src/renderer/stores/atoms/throttleWriteSessionAtom.ts`) coalesces rapid streaming updates

### Binary Blobs (images, files)

File contents and images are stored separately as blobs via `storage.setBlob(storageKey, data)` / `storage.getBlob(storageKey)` using `StorageKeyGenerator` (`src/renderer/storage/StoreStorage.ts`).  
IndexedDB is used for binary blobs on all platforms; on mobile SQLite stores them as base64.

### Settings Persistence

`settingsStore.ts` (Zustand) loads from and writes to `StorageKey.Settings` via the platform storage. On desktop this goes through IPC to `electron-store` (a JSON file).

---

## 9. Provider System

### Registry Pattern

**Files:**
- `src/shared/providers/registry.ts` — `defineProvider(definition)` registers to `providerRegistry: Map`
- `src/shared/providers/index.ts` — `getModel(settings, globalSettings, config, dependencies)` looks up registry
- `src/shared/providers/definitions/models/` — one file per provider

**Registering a provider:**
```typescript
// src/shared/providers/definitions/models/openai.ts (simplified)
export default defineProvider({
  id: ModelProviderEnum.OpenAI,
  createModel: (config: CreateModelConfig): ModelInterface => new OpenAI(config),
})
```

22 providers call `defineProvider()` at module load time.

### getModel (`src/shared/providers/index.ts:126`)

```
getModel(settings, globalSettings, config, dependencies)
  ├── getProviderDefinition(settings.provider)
  ├── if registered → providerDefinition.createModel(createConfig)
  ├── if custom provider → createCustomProviderModel(…)
  └── else → throw "Cannot find model"
```

### ModelInterface / AbstractAISDKModel

All models implement `ModelInterface` (defined in `src/shared/models/`). `AbstractAISDKModel` provides:
- `chat(messages, options)` — main streaming call
- `isSupportToolUse(scope?)` — tool use capability check
- `isSupportVision()` / `isSupportSystemMessage()`
- `modelId` — the raw model ID string

Provider-specific classes (`OpenAI`, `Claude`, `Gemini`, etc.) in `src/shared/providers/definitions/models/` extend `AbstractAISDKModel` and override capabilities.

---

## 10. MCP Tool Integration

### Architecture

MCP spans two processes:

**Main process** (`src/main/mcp/`): Manages stdio child processes for MCP servers. Exposes IPC handlers that the renderer communicates with.

**Renderer** (`src/renderer/packages/mcp/`):
- `IPCStdioTransport` (`ipc-stdio-transport.ts`) — bridges MCP stdio to IPC
- `MCPServer` class (`controller.ts`) — wraps `createMCPClient()` from `@ai-sdk/mcp`, manages start/stop lifecycle
- `mcpController` singleton — manages the `Map<string, { instance: MCPServer, config }>` of all configured servers

### getAvailableTools (`src/renderer/packages/mcp/controller.ts:197`)

```typescript
getAvailableTools(): ToolSet {
  const toolSet: ToolSet = {}
  for (const { instance, config } of this.servers.values()) {
    const mcpTools = instance.getAvailableTools()
    for (const [toolName, tool] of Object.entries(mcpTools)) {
      toolSet[normalizeToolName(config.name, toolName)] = {
        ...tool,
        execute: async (args, options) => {
          try { return await rawExecute?.(args, options) }
          catch (err) { return err }   // returns error instead of throwing
        },
      }
    }
  }
  return toolSet
}
```

Tool names are normalized as `{serverName}_{toolName}` to avoid collisions.

### Merging into LLM calls

In `streamText` at line 296:
```typescript
let tools: ToolSet = { ...mcpController.getAvailableTools() }
// then web_search, kb, and file tools are spread in
model.chat(coreMessages, { tools, … })
```

MCP servers are configured in Settings → MCP and stored in `MCPSettings` in `src/shared/types/settings.ts`.

---

## 11. Context Management

### Token Counting

- `estimateTokens(text, tokenizer)` — `src/renderer/packages/token-estimation/tokenizer.ts`
- `estimateTokensFromMessages(messages)` — `src/renderer/packages/token.tsx` — estimates cost of a full message array
- `ComputationQueue` — debounced queue so token counting doesn't block UI

Token counting uses `tiktoken` (default) and a DeepSeek tokenizer variant.

### Compaction / Summarization

**Trigger:** Called in `submitNewUserMessage` before every user message send (for `type === 'chat'` sessions).

**Flow:**
```
runCompactionWithUIState(sessionId)         ← src/renderer/packages/context-management/compaction.ts:124
  ├── needsCompaction(sessionId)            ← checks token count vs. model context window
  ├── setCompactionUIState(…, 'running')    ← shows compaction indicator in UI
  ├── runCompactionWithStreaming(sessionId) ← summarizes old messages via LLM
  │     → generateSummaryWithStream()       ← src/renderer/packages/context-management/summary-generator.ts
  │           → calls streamText with summarizeConversation prompt
  │           → inserts a synthetic 'summary' message with compactionPoint=true
  └── setCompactionUIState(…, 'idle')
```

`genMessageContext` (generation.ts:379) respects `compactionPoints` — it only includes messages after the most recent compaction point.

### Attachment Handling

Files and links are pre-processed in `InputBox` with a `storageKey` (blob stored in IndexedDB) before `submitNewUserMessage` is called. Inside `streamText`, the `fileToolSet` provides a `read_file` tool that fetches the blob by `storageKey` at inference time.

---

## 12. Authentication

Authentication is a **license key system** (not session/OAuth for the app itself).

**Provider:** Lemon Squeezy  
**Files:**
- `src/renderer/packages/lemonsqueezy.ts` — `activateLicense(key, instanceName)`, `deactivateLicense(key, instanceId)`
- `src/renderer/packages/remote.ts` — `getLicenseDetailRealtime()`, `getLicenseDetail()`
- `src/renderer/stores/settingActions.ts` — `isPro()`, `getLicenseKey()`, `getLicenseDetail()`

**How it works:**
1. User enters license key in Settings → Provider → Chatbox AI
2. `activateLicense()` calls Lemon Squeezy API to validate and register the instance
3. On success, license detail is cached in `Settings.licenseDetail`
4. `isPro()` checks `licenseDetail.isValid` — gates features like advanced document parsing, extended context, etc.

OAuth for individual providers (e.g., Google) is stored in `ProviderSettings.oauth` per-provider.

---

## 13. Real-time Communication

### Streaming Pattern

The AI SDK's `streamText()` in `AbstractAISDKModel.chat()` returns an `AsyncIterable` of chunks. The model class calls `onResultChange(partialResult)` on each chunk.

In `generate()` (generation.ts), the callback is `modifyMessageCache` which:
1. Merges the partial result into `targetMsg`
2. Calls `modifyMessage(sessionId, targetMsg, false, !shouldPersist)` — cache-only update during streaming
3. Every 2 seconds (`persistInterval = 2000`), forces a storage write

React re-renders because `chatStore` uses TanStack Query — `modifyMessage` calls `queryClient.setQueryData(...)` which triggers re-renders in components subscribed to the query.

### Abort / Cancel

Each message gets a `cancel` function from an `AbortController`:
```typescript
const controller = new AbortController()
params.onResultChangeWithCancel({ cancel: () => controller.abort() })
model.chat(coreMessages, { signal: controller.signal, … })
```

The `cancel` fn is stored in `Message.cancel` so UI can call it.

### WebSockets

Not used for chat streaming. The MCP HTTP transport (`StreamableHTTPClientTransport`) may use SSE (Server-Sent Events) for MCP servers configured with `type: 'http'`.

---

## 14. Artifact / iframe System

**File:** `src/renderer/components/Artifact.tsx`

### How it works

```
MessageArtifact (outer wrapper)
  ├── fetches contextMessages (all messages before this one in the thread)
  ├── calls generateHtml([...contextMessages text, current messageContent])
  │     → parses markdown for ```html, ```css, ```js code blocks
  │     → assembles an srcdoc string with Tailwind CDN + the code
  └── renders ArtifactWithButtons(htmlCode)
        └── Artifact({ htmlCode, reloadSign })
              └── <iframe sandbox="allow-scripts allow-forms"
                           src="https://artifact-preview.chatboxai.app/preview"
                           ref={ref} />
```

### postMessage Protocol

The iframe at `https://artifact-preview.chatboxai.app/preview` listens for messages. Chatbox sends:

```typescript
ref.current.contentWindow?.postMessage({ type: 'html', code: htmlCode }, '*')
```

Timing:
- On `reloadSign` change: send `{type:'html', code:''}` → wait 1500ms → send `{type:'html', code:htmlCode}`
- On `htmlCode` change: debounced (300ms) send of new code

### Sandbox

```html
sandbox="allow-scripts allow-forms"
```

Notably **no** `allow-same-origin` — the iframe cannot access the parent's localStorage/cookies. `allow-popups` is also absent.

### generateHtml function

`generateHtml(markdowns: string[])` (Artifact.tsx, end of file):
- Takes an array of markdown strings (context messages + current)
- Extracts the **last** `html`, `css`, `js`/`javascript` code block from each
- Assembles: Tailwind CDN `<script>` + HTML body + `<style>` CSS + `<script>` JS

---

## 15. Extension Points for ChatBridge

These are the exact hooks and injection points relevant to building the ChatBridge plugin system:

### A. Inject New Tool Schemas into LLM calls

**File:** `src/renderer/packages/model-calls/stream-text.ts`  
**Location:** Line ~296 (tool set assembly block)

```typescript
// CURRENT CODE:
let tools: ToolSet = { ...mcpController.getAvailableTools() }
if (webBrowsing) tools.web_search = webSearchTool

// INJECT HERE — add ChatBridge tools to the tool set:
if (chatBridgeEnabled) {
  tools = { ...tools, ...chatBridgeController.getTools() }
}
```

The `ToolSet` type from `ai` is `Record<string, Tool>` where each tool has `{ description, parameters: ZodSchema, execute }`.

### B. Inject System Prompt Context

**File:** `src/renderer/packages/model-calls/message-utils.ts`  
**Function:** `injectModelSystemPrompt` at line 119

Current signature:
```typescript
export function injectModelSystemPrompt(
  model: string,
  messages: Message[],
  additionalInfo: string,    // ← THIS IS THE INJECTION POINT
  role: 'system' | 'user' = 'system'
)
```

The `additionalInfo` string is passed from `streamText` as `toolSetInstructions` (concatenation of toolset description strings). Add ChatBridge context here by:

**Option 1:** Extend `streamText` params to accept `additionalSystemContext?: string`, append to `toolSetInstructions`  
**Option 2:** Create a `chatBridgeSystemPrompt()` function and concat in `streamText` before calling `injectModelSystemPrompt`

### C. Pre/Post Processing Hooks

**submitNewUserMessage** (`src/renderer/stores/session/messages.ts:111`) — pre-processing point before user message is inserted. Good for:
- Message transformation / augmentation
- Injecting ChatBridge context as a system message at start of session

**generate** (`src/renderer/stores/session/generation.ts:110`) — wraps the entire generation lifecycle. Good for:
- Pre-generation: modify `targetMsg` before streaming starts
- Post-generation: analyze completed message, trigger ChatBridge callbacks

### D. The Existing postMessage/iframe Pattern

The `Artifact.tsx` pattern is the template for ChatBridge iframes:

```typescript
// Pattern to replicate:
const iframeRef = useRef<HTMLIFrameElement>(null)
iframeRef.current?.contentWindow?.postMessage({ type: 'chatbridge', data: payload }, '*')

// Receive from iframe:
window.addEventListener('message', (event) => {
  if (event.source === iframeRef.current?.contentWindow) {
    handleChatBridgeMessage(event.data)
  }
})
```

The existing sandbox `allow-scripts allow-forms` is sufficient for most plugin use cases. Add `allow-same-origin` only if the plugin needs to persist data in its own origin.

### E. Adding a New Zustand Store

Pattern from `src/renderer/stores/uiStore.ts`:

```typescript
// src/renderer/stores/chatBridgeStore.ts
import { create } from 'zustand'

type ChatBridgeState = {
  plugins: PluginConfig[]
  activePlugin: string | null
  // …
  setActivePlugin: (id: string | null) => void
}

export const chatBridgeStore = create<ChatBridgeState>((set) => ({
  plugins: [],
  activePlugin: null,
  setActivePlugin: (id) => set({ activePlugin: id }),
}))
```

Import and use anywhere in the renderer with `chatBridgeStore.getState()` (outside React) or `useChatBridgeStore` hook (inside React).

### F. Platform Abstraction for New Capabilities

**File:** `src/renderer/platform/interfaces.ts`

The `Platform` interface defines capabilities available on each target. To add a ChatBridge-specific capability (e.g., launching a local plugin server):

1. Add the method to the interface in `interfaces.ts`
2. Implement it in `desktop_platform.ts` (with IPC call to main process)
3. Implement a no-op / web fallback in `web_platform.ts`

The `platform` singleton will automatically dispatch to the right implementation.

---

## 16. Recommended Approach for ChatBridge

Based on the architecture above, here is the path of least resistance:

### Files to Create

| File | Purpose |
|---|---|
| `src/renderer/stores/chatBridgeStore.ts` | Zustand store for plugin registry and state |
| `src/renderer/packages/chatbridge/controller.ts` | Plugin lifecycle: load, start, stop, getTools() |
| `src/renderer/packages/chatbridge/tool-bridge.ts` | Convert ChatBridge plugin manifests to AI SDK `ToolSet` |
| `src/renderer/components/ChatBridgeFrame.tsx` | iframe component (clone/extend Artifact.tsx pattern) |
| `src/shared/types/chatbridge.ts` | Zod schemas for `PluginManifest`, `PluginConfig`, `BridgeMessage` |

### Files to Modify

| File | Change | Why |
|---|---|---|
| `src/renderer/packages/model-calls/stream-text.ts` | Add ChatBridge tool set at line ~296 | Inject plugin tools into every LLM call |
| `src/renderer/packages/model-calls/stream-text.ts` | Extend `toolSetInstructions` concat | Inject plugin system prompts |
| `src/shared/types/settings.ts` | Add `ChatBridgeSettings` to `SettingsSchema` | Persist plugin configs |
| `src/renderer/stores/settingsStore.ts` | Expose `chatBridgeSettings` getter/setter | Read/write plugin config |
| `src/renderer/routes/settings/` | Add settings page for ChatBridge plugins | UI for managing plugins |

### Minimal Schema Addition

In `src/shared/types/settings.ts`, add alongside `MCPSettings`:
```typescript
export const ChatBridgePluginConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean().default(true),
  entrypoint: z.string(),           // URL or local path
  transport: z.enum(['iframe', 'http', 'stdio']),
  tools: z.array(z.string()).optional(),  // tool names exposed by this plugin
})

export const ChatBridgeSettingsSchema = z.object({
  plugins: z.array(ChatBridgePluginConfigSchema).default([]),
})
```

### Integration with MCP (Alternative)

If plugins expose MCP-compatible tool servers, they can be registered directly via the existing `MCPSettings` / `mcpController` — no schema changes needed. The ChatBridge layer would then be purely UI (the iframe component + message routing) rather than also hooking into the tool pipeline.

### The Minimal Viable Change

To add a single ChatBridge tool to every LLM call with zero new files:

1. Add tool schema to `stream-text.ts` lines 296-316 (alongside existing tool assembly)
2. Add plugin iframe panel to the chat route using the `Artifact.tsx` pattern
3. Wire `postMessage` to route tool call results from the LLM response to the iframe

This avoids touching any store, schema, or settings — it's a 3-file change.
