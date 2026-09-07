# Context Module

Pure function context builder for AI message preparation. **Production context builder** used by orchestration layer.

## Exports

```typescript
import { buildContext } from '@shared/context'
import type { AttachmentResolver, ContextBuilderOptions } from '@shared/context'
```

## Core API

### buildContext()

**Production context builder** - Pure function that prepares messages for AI generation.

Used directly by `orchestration.ts` and wrapped by `genMessageContext()` in the session module.

```typescript
async function buildContext(
  messages: Message[],
  options: ContextBuilderOptions
): Promise<Message[]>
```

**Processing pipeline:**
1. Filter incomplete messages (`generating: true`)
2. Apply compaction (from latest compaction point)
3. Apply message count limit
4. Apply tool cleanup per `toolCleanupMode` (pressure-driven; see below)
5. Inject attachment content via AttachmentResolver

Steps 1–3 are also exported standalone as `selectContextMessages()` so pressure
estimation can measure exactly the selection the send path will use.

**Usage pattern:**
```typescript
import { buildContext, createAttachmentResolver } from '@shared/context'

const resolver = createAttachmentResolver()
const contextMessages = await buildContext(messages, {
  attachmentResolver: resolver,
  toolCleanupMode: 'none',
  maxContextMessageCount: 50,
})
```

### AttachmentResolver

Platform abstraction for reading attachments. Implemented by renderer.

```typescript
interface AttachmentResolver {
  read(id: string): Promise<string | null>
}
```

### ContextBuilderOptions

```typescript
interface ContextBuilderOptions {
  attachmentResolver: AttachmentResolver
  maxContextMessageCount?: number
  compactionPoints?: CompactionPoint[]
  toolCleanupMode: ToolCleanupMode
  keepToolCallRounds?: number
  preserveToolCallMessageIds?: string[]
  modelSupportToolUseForFile?: boolean
  sandboxMode?: boolean
}
```

**Options:**
- `attachmentResolver` - Required. Platform abstraction for accessing attachments
- `maxContextMessageCount` - Optional. Limits context to the most recent N messages
- `compactionPoints` - Optional. History compression points for context optimization
- `toolCleanupMode` - Required, so every caller makes an explicit choice. `'none'` keeps all
  tool calls/results intact (use below the pressure threshold, and for contexts that never
  reach a model); `'stub-old-results'` keeps calls but stubs old result payloads (use under
  pressure, or unconditionally for callers without pressure assessment that need bounded tool
  history). Pressure resolution lives in the renderer (`context-management/context-pressure.ts`).
- `keepToolCallRounds` - Optional. Number of recent tool call rounds kept fully intact when a
  cleanup mode is active (default: 2)
- `preserveToolCallMessageIds` - Optional. Message ids exempt from cleanup (cache-friendly
  continuation flows)
- `modelSupportToolUseForFile` - Optional. Whether model supports tool use for file reading (default: false)
- `sandboxMode` - Optional. Inject attachment metadata instead of content (default: false)

## Architecture

- **Single source of truth** - `buildContext()` is the only context builder in production
- **Zero renderer dependencies** - Pure shared module
- **Immutable** - Never mutates input messages
- **Dependency injection** - AttachmentResolver provided by caller
- **Thin wrapper pattern** - `genMessageContext()` in session module wraps `buildContext()` with session-specific logic
