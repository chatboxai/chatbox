# Context Module

Pure function context builder for AI message preparation. **Production context builder** used by the session generation entrypoints.

## Exports

```typescript
import { buildContext } from '@shared/context'
import type { AttachmentResolver, ContextBuilderOptions } from '@shared/context'
```

## Core API

### buildContext()

**Production context builder** - Pure function that prepares messages for AI generation.

Used by the session agent harness and wrapped by `genMessageContext()` for compatibility callers.

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
4. Inject attachment content via AttachmentResolver

Steps 1–3 are also exported standalone as `selectContextMessages()` so token
estimation can measure exactly the selection the send path will use.

**Usage pattern:**
```typescript
import { buildContext } from '@shared/context'
import { createAttachmentResolver } from '@/stores/session'

const resolver = createAttachmentResolver()
const contextMessages = await buildContext(messages, {
  attachmentResolver: resolver,
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
  modelSupportToolUseForFile?: boolean
  sandboxMode?: boolean
}
```

**Options:**
- `attachmentResolver` - Required. Platform abstraction for accessing attachments
- `maxContextMessageCount` - Optional. Limits context to the most recent N messages
- `compactionPoints` - Optional. History compression points for context optimization
- `modelSupportToolUseForFile` - Optional. Whether model supports tool use for file reading (default: false)
- `sandboxMode` - Optional. Inject attachment metadata instead of content (default: false)

## Architecture

- **Single source of truth** - `buildContext()` is the only context builder in production
- **Zero renderer dependencies** - Pure shared module
- **Immutable** - Never mutates input messages
- **Dependency injection** - AttachmentResolver provided by caller
- **Thin wrapper pattern** - `genMessageContext()` in session module wraps `buildContext()` with session-specific logic
