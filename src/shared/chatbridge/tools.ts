import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

export const CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION = 1 as const

const CHATBRIDGE_HOST_TOOL_RECORD_KIND = 'chatbridge.host.tool.record.v1' as const
const CHATBRIDGE_HOST_TOOL_METADATA = Symbol('chatbridge.host.tool.metadata')

const MAX_NORMALIZED_DEPTH = 4
const MAX_NORMALIZED_ARRAY_ITEMS = 20
const MAX_NORMALIZED_OBJECT_KEYS = 20

export type ChatBridgeToolEffect = 'read' | 'side-effect'
export type ChatBridgeRetryClassification = 'safe' | 'unsafe'
export type ChatBridgeToolOutcomeStatus = 'success' | 'error' | 'rejected'
export type ChatBridgeHostToolState = 'result' | 'error'

export interface ChatBridgeHostToolErrorRecord {
  code: string
  message: string
  details?: unknown
}

export interface ChatBridgeHostToolMetadata<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  appId: string
  schemaVersion: number
  effect: ChatBridgeToolEffect
  retryClassification: ChatBridgeRetryClassification
  inputSchema: TSchema
  idempotencyKeyField?: string
  executionAuthority?: 'host'
}

export interface ChatBridgeHostToolDefinition<TSchema extends z.ZodTypeAny>
  extends Omit<ChatBridgeHostToolMetadata<TSchema>, 'executionAuthority'> {
  description: string
  execute: (input: z.infer<TSchema>, context: { abortSignal?: AbortSignal }) => Promise<unknown> | unknown
}

export interface ChatBridgeHostToolExecutionRecord {
  kind: typeof CHATBRIDGE_HOST_TOOL_RECORD_KIND
  toolName: string
  appId: string
  sessionId?: string
  schemaVersion: number
  executionAuthority: 'host'
  effect: ChatBridgeToolEffect
  retryClassification: ChatBridgeRetryClassification
  invocation: {
    args: unknown
    idempotencyKey?: string
  }
  outcome: {
    status: ChatBridgeToolOutcomeStatus
    result?: unknown
    error?: ChatBridgeHostToolErrorRecord
  }
}

export interface ChatBridgeHostToolPartUpdate {
  args: unknown
  result: ChatBridgeHostToolExecutionRecord
  state: ChatBridgeHostToolState
}

type ChatBridgeHostToolLike = {
  description?: string
  execute?: (input: unknown, context: { abortSignal?: AbortSignal }) => Promise<unknown> | unknown
  [CHATBRIDGE_HOST_TOOL_METADATA]?: ChatBridgeHostToolMetadata
}

type NormalizeState = {
  depth: number
  seen: WeakSet<object>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeValue(value: unknown, state: NormalizeState = { depth: 0, seen: new WeakSet<object>() }): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (typeof value === 'function') {
    return '[function]'
  }

  if (typeof value === 'symbol') {
    return '[symbol]'
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack } : {}),
    }
  }

  if (state.depth >= MAX_NORMALIZED_DEPTH) {
    return '[max-depth]'
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_NORMALIZED_ARRAY_ITEMS).map((entry) =>
      normalizeValue(entry, {
        depth: state.depth + 1,
        seen: state.seen,
      })
    )
  }

  if (typeof value === 'object') {
    if (state.seen.has(value)) {
      return '[circular]'
    }

    state.seen.add(value)

    const entries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, MAX_NORMALIZED_OBJECT_KEYS)

    return Object.fromEntries(
      entries.map(([key, entryValue]) => [
        key,
        normalizeValue(entryValue, {
          depth: state.depth + 1,
          seen: state.seen,
        }),
      ])
    )
  }

  return String(value)
}

function getIdempotencyKey(input: unknown, idempotencyKeyField: string): string | undefined {
  if (!isRecord(input)) {
    return undefined
  }

  const rawValue = input[idempotencyKeyField]
  if (typeof rawValue !== 'string') {
    return undefined
  }

  const trimmed = rawValue.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function createExecutionRecord(options: {
  toolName: string
  metadata: ChatBridgeHostToolMetadata
  sessionId?: string
  args: unknown
  idempotencyKey?: string
  status: ChatBridgeToolOutcomeStatus
  result?: unknown
  error?: ChatBridgeHostToolErrorRecord
}): ChatBridgeHostToolExecutionRecord {
  return {
    kind: CHATBRIDGE_HOST_TOOL_RECORD_KIND,
    toolName: options.toolName,
    appId: options.metadata.appId,
    sessionId: options.sessionId,
    schemaVersion: options.metadata.schemaVersion,
    executionAuthority: options.metadata.executionAuthority ?? 'host',
    effect: options.metadata.effect,
    retryClassification: options.metadata.retryClassification,
    invocation: {
      args: normalizeValue(options.args),
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    },
    outcome: {
      status: options.status,
      ...(options.result !== undefined ? { result: normalizeValue(options.result) } : {}),
      ...(options.error
        ? {
            error: {
              ...options.error,
              ...(options.error.details !== undefined ? { details: normalizeValue(options.error.details) } : {}),
            },
          }
        : {}),
    },
  }
}

export function createChatBridgeHostTool<TSchema extends z.ZodTypeAny>(
  definition: ChatBridgeHostToolDefinition<TSchema>
) {
  const baseTool = tool({
    description: definition.description,
    inputSchema: definition.inputSchema,
    execute: definition.execute,
  })

  return Object.assign(baseTool, {
    [CHATBRIDGE_HOST_TOOL_METADATA]: {
      appId: definition.appId,
      schemaVersion: definition.schemaVersion,
      effect: definition.effect,
      retryClassification: definition.retryClassification,
      inputSchema: definition.inputSchema,
      idempotencyKeyField: definition.idempotencyKeyField ?? 'idempotencyKey',
      executionAuthority: 'host' as const,
    },
  })
}

export function isChatBridgeHostTool(toolLike: unknown): toolLike is ChatBridgeHostToolLike {
  return isRecord(toolLike) && CHATBRIDGE_HOST_TOOL_METADATA in toolLike
}

export function getChatBridgeHostToolMetadata(toolLike: unknown): ChatBridgeHostToolMetadata | null {
  if (!isChatBridgeHostTool(toolLike)) {
    return null
  }
  return toolLike[CHATBRIDGE_HOST_TOOL_METADATA] ?? null
}

export function isChatBridgeHostToolExecutionRecord(value: unknown): value is ChatBridgeHostToolExecutionRecord {
  if (!isRecord(value)) {
    return false
  }

  return value.kind === CHATBRIDGE_HOST_TOOL_RECORD_KIND
}

export function getChatBridgeHostToolPartUpdate(value: unknown): ChatBridgeHostToolPartUpdate | null {
  if (!isChatBridgeHostToolExecutionRecord(value)) {
    return null
  }

  return {
    args: value.invocation.args,
    result: value,
    state: value.outcome.status === 'success' ? 'result' : 'error',
  }
}

export function wrapChatBridgeHostTools(
  toolSet: ToolSet,
  options: {
    sessionId?: string
    supportedSchemaVersions?: number[]
  } = {}
): ToolSet {
  const supportedSchemaVersions = options.supportedSchemaVersions ?? [CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION]
  const wrappedTools: ToolSet = {}

  for (const [toolName, toolLike] of Object.entries(toolSet)) {
    const metadata = getChatBridgeHostToolMetadata(toolLike)
    if (!metadata) {
      wrappedTools[toolName] = toolLike
      continue
    }

    const executableTool = toolLike as ChatBridgeHostToolLike
    const rawExecute = executableTool.execute?.bind(executableTool)

    wrappedTools[toolName] = {
      ...toolLike,
      execute: async (rawArgs: unknown, context: { abortSignal?: AbortSignal } = {}) => {
        if (!supportedSchemaVersions.includes(metadata.schemaVersion)) {
          return createExecutionRecord({
            toolName,
            metadata,
            sessionId: options.sessionId,
            args: rawArgs,
            status: 'rejected',
            error: {
              code: 'schema_version_mismatch',
              message: `Unsupported ChatBridge tool schema version: ${metadata.schemaVersion}`,
              details: {
                supportedSchemaVersions,
              },
            },
          })
        }

        const parsed = metadata.inputSchema.safeParse(rawArgs)
        if (!parsed.success) {
          return createExecutionRecord({
            toolName,
            metadata,
            sessionId: options.sessionId,
            args: rawArgs,
            status: 'rejected',
            error: {
              code: 'invalid_arguments',
              message: 'Tool arguments failed host validation.',
              details: parsed.error.issues,
            },
          })
        }

        const parsedArgs = parsed.data
        const idempotencyKey = getIdempotencyKey(parsedArgs, metadata.idempotencyKeyField ?? 'idempotencyKey')
        if (metadata.effect === 'side-effect' && !idempotencyKey) {
          return createExecutionRecord({
            toolName,
            metadata,
            sessionId: options.sessionId,
            args: parsedArgs,
            status: 'rejected',
            error: {
              code: 'missing_idempotency_key',
              message: `Side-effecting tool "${toolName}" requires an idempotency key.`,
            },
          })
        }

        if (!rawExecute) {
          return createExecutionRecord({
            toolName,
            metadata,
            sessionId: options.sessionId,
            args: parsedArgs,
            idempotencyKey,
            status: 'rejected',
            error: {
              code: 'missing_execute_handler',
              message: `Tool "${toolName}" has no execute handler.`,
            },
          })
        }

        try {
          const rawResult = await rawExecute(parsedArgs, context)
          return createExecutionRecord({
            toolName,
            metadata,
            sessionId: options.sessionId,
            args: parsedArgs,
            idempotencyKey,
            status: 'success',
            result: rawResult,
          })
        } catch (error) {
          return createExecutionRecord({
            toolName,
            metadata,
            sessionId: options.sessionId,
            args: parsedArgs,
            idempotencyKey,
            status: 'error',
            error: {
              code: 'tool_execution_failed',
              message: `Tool "${toolName}" failed during host execution.`,
              details: error,
            },
          })
        }
      },
    }
  }

  return wrappedTools
}
