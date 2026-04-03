import type { ToolExecutionOptions, ToolSet } from 'ai'
import { z } from 'zod'
import type {
  ChatBridgeExecutionGovernorSelectionSource,
  ChatBridgeHostRuntime,
  ChatBridgeRouteDecision,
  ChatBridgeJsonSchema,
  ChatBridgeToolSchema,
  ReviewedAppCatalogEntry,
} from '@shared/chatbridge'
import {
  CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION,
  ChatBridgeHostRuntimeSchema,
  createChatBridgeHostTool,
  ensureDefaultReviewedAppsRegistered,
  isChatBridgeHostToolExecutionRecord,
  isReviewedAppSupportedOnHostRuntime,
  resolveReviewedSingleAppSelection,
  selectChatBridgeAppContexts,
  wrapChatBridgeHostTools,
  type ReviewedSingleAppSelection,
} from '@shared/chatbridge'
import type { Message } from '@shared/types'
import platform from '@/platform'
import { getReviewedAppRouteDecision } from './router/decision'

const DEFAULT_LIVE_REVIEWED_APP_PERMISSIONS = ['session.context.read', 'weather.read'] as const

const ChessPrepareSessionInputSchema = z.object({
  request: z.string().trim().min(1),
  fen: z.string().trim().min(1).optional(),
  pgn: z.string().trim().min(1).optional(),
})

type ChessPrepareSessionInput = z.infer<typeof ChessPrepareSessionInputSchema>
type GenericReviewedAppToolInput = Record<string, unknown>
type ReviewedAppToolExecutor = (input: GenericReviewedAppToolInput) => Promise<unknown> | unknown
export type ReviewedAppToolExecutors = Record<string, ReviewedAppToolExecutor> & {
  chess_prepare_session?: (input: ChessPrepareSessionInput) => Promise<unknown> | unknown
}

type CreateReviewedSingleAppToolSetOptions = {
  messages: Message[]
  contextInput?: unknown
  executors?: ReviewedAppToolExecutors
  entries?: ReviewedAppCatalogEntry[]
}

type ReviewedSingleAppToolSetResult = {
  selection: ReviewedSingleAppSelection
  tools: ToolSet
  routeDecision: ChatBridgeRouteDecision
  selectionSource: ChatBridgeExecutionGovernorSelectionSource
  suppressRouteArtifact?: boolean
}

function resolvePlatformHostRuntime(): ChatBridgeHostRuntime {
  return platform.type === 'desktop' ? 'desktop-electron' : 'web-browser'
}

function createDefaultLiveReviewedAppContext() {
  return {
    grantedPermissions: [...DEFAULT_LIVE_REVIEWED_APP_PERMISSIONS],
    hostRuntime: resolvePlatformHostRuntime(),
  }
}

function mergeReviewedAppContextInput(contextInput: unknown) {
  const defaultContext = createDefaultLiveReviewedAppContext()

  if (!contextInput || typeof contextInput !== 'object' || Array.isArray(contextInput)) {
    return contextInput ?? defaultContext
  }

  return {
    ...defaultContext,
    ...contextInput,
  }
}

function resolveHostRuntimeFromContextInput(contextInput: unknown): ChatBridgeHostRuntime {
  if (contextInput && typeof contextInput === 'object' && !Array.isArray(contextInput)) {
    const parsedRuntime = ChatBridgeHostRuntimeSchema.safeParse((contextInput as { hostRuntime?: unknown }).hostRuntime)
    if (parsedRuntime.success) {
      return parsedRuntime.data
    }
  }

  return resolvePlatformHostRuntime()
}

function getLatestUserPrompt(messages: Message[]) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user')
  if (!latestUserMessage) {
    return ''
  }

  return latestUserMessage.contentParts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join(' ')
    .trim()
}

function deriveCapability(appId: string, toolName: string) {
  const normalizedAppId = appId.replace(/-/g, '_')
  const suffix = toolName.startsWith(`${normalizedAppId}_`) ? toolName.slice(normalizedAppId.length + 1) : toolName
  return suffix.replace(/[_:]/g, '-')
}

function createInvalidSchemaError(toolName: string, reason: string) {
  return new Error(`Unsupported reviewed tool schema for "${toolName}": ${reason}`)
}

function toZodSchema(schema: ChatBridgeJsonSchema, path = 'root'): z.ZodTypeAny {
  switch (schema.type) {
    case 'string': {
      let result = z.string()
      if (typeof schema.minLength === 'number') {
        result = result.min(schema.minLength)
      }
      if (typeof schema.maxLength === 'number') {
        result = result.max(schema.maxLength)
      }
      return result
    }
    case 'number': {
      let result = z.number()
      if (typeof schema.minimum === 'number') {
        result = result.min(schema.minimum)
      }
      if (typeof schema.maximum === 'number') {
        result = result.max(schema.maximum)
      }
      return result
    }
    case 'integer': {
      let result = z.number().int()
      if (typeof schema.minimum === 'number') {
        result = result.min(schema.minimum)
      }
      if (typeof schema.maximum === 'number') {
        result = result.max(schema.maximum)
      }
      return result
    }
    case 'boolean':
      return z.boolean()
    case 'array': {
      if (!schema.items) {
        throw createInvalidSchemaError(path, 'array schema is missing items')
      }

      let result = z.array(toZodSchema(schema.items, `${path}[]`))
      if (typeof schema.minItems === 'number') {
        result = result.min(schema.minItems)
      }
      if (typeof schema.maxItems === 'number') {
        result = result.max(schema.maxItems)
      }
      return result
    }
    case 'object': {
      const properties = schema.properties ?? {}
      const required = new Set(schema.required ?? [])
      const shape = Object.fromEntries(
        Object.entries(properties).map(([key, value]) => {
          const propertySchema = toZodSchema(value, `${path}.${key}`)
          return [key, required.has(key) ? propertySchema : propertySchema.optional()]
        })
      )

      return z.object(shape).strict()
    }
    default:
      throw createInvalidSchemaError(path, `unsupported schema type "${schema.type ?? 'unknown'}"`)
  }
}

function createSelectionFromRouteDecision(
  routeDecision: ChatBridgeRouteDecision,
  entries: ReviewedAppCatalogEntry[]
): ReviewedSingleAppSelection | null {
  if (routeDecision.kind !== 'invoke' || !routeDecision.selectedAppId) {
    return null
  }

  const catalogEntry = entries.find((entry) => entry.manifest.appId === routeDecision.selectedAppId)
  const toolName = catalogEntry?.manifest.toolSchemas[0]?.name
  if (!catalogEntry || !toolName) {
    return null
  }

  const selectedMatch = routeDecision.matches.find((match) => match.appId === routeDecision.selectedAppId)

  return {
    status: 'matched',
    appId: catalogEntry.manifest.appId,
    appName: catalogEntry.manifest.name,
    toolName,
    matchedTerms: selectedMatch?.matchedTerms ?? [],
    promptText: routeDecision.prompt,
    catalogEntry,
  }
}

function createReviewedAppLaunchTool(
  selection: Extract<ReviewedSingleAppSelection, { status: 'matched' }>,
  execute?: ReviewedAppToolExecutor
) {
  const toolSchema = selection.catalogEntry.manifest.toolSchemas.find((schema) => schema.name === selection.toolName)
  if (!toolSchema) {
    throw new Error(`Reviewed tool "${selection.toolName}" is missing from app "${selection.appId}".`)
  }

  const inputSchema =
    selection.toolName === 'chess_prepare_session'
      ? ChessPrepareSessionInputSchema
      : toZodSchema(toolSchema.inputSchema, toolSchema.name)

  return createChatBridgeHostTool({
    description: toolSchema.description,
    appId: selection.appId,
    schemaVersion: CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION,
    effect: 'read',
    retryClassification: 'safe',
    inputSchema,
    execute: async (input) => {
      const normalizedInput = input as GenericReviewedAppToolInput

      return (
        execute?.(normalizedInput) ?? {
          appId: selection.appId,
          appName: selection.appName,
          capability: deriveCapability(selection.appId, selection.toolName),
          launchReady: true,
          summary: `Prepared the reviewed ${selection.appName} request for the host-owned launch path.`,
          ...(typeof normalizedInput.request === 'string' ? { request: normalizedInput.request } : {}),
          ...(typeof normalizedInput.location === 'string' ? { location: normalizedInput.location } : {}),
          ...(typeof normalizedInput.fen === 'string' ? { fen: normalizedInput.fen } : {}),
          ...(typeof normalizedInput.pgn === 'string' ? { pgn: normalizedInput.pgn } : {}),
        }
      )
    },
  })
}

function createToolsForSelection(
  selection: ReviewedSingleAppSelection,
  executors: ReviewedAppToolExecutors | undefined
): ToolSet {
  if (selection.status !== 'matched') {
    return {}
  }

  return {
    [selection.toolName]: createReviewedAppLaunchTool(selection, executors?.[selection.toolName]),
  }
}

function shouldSuppressActiveAppRouteArtifact(messages: Message[], routeDecision: ChatBridgeRouteDecision): boolean {
  if (routeDecision.kind !== 'clarify' || !routeDecision.selectedAppId) {
    return false
  }

  return selectChatBridgeAppContexts(messages).some(
    (selection) => selection.lifecycle === 'active' && selection.appId === routeDecision.selectedAppId
  )
}

export function createReviewedToolsForSelection(
  selection: ReviewedSingleAppSelection,
  executors?: ReviewedAppToolExecutors
): ToolSet {
  return createToolsForSelection(selection, executors)
}

export function buildReviewedSelectionInput(
  selection: Extract<ReviewedSingleAppSelection, { status: 'matched' }>
): GenericReviewedAppToolInput {
  return {
    request: selection.promptText,
  }
}

export async function executeReviewedSelection(options: {
  selection: Extract<ReviewedSingleAppSelection, { status: 'matched' }>
  sessionId?: string
  executors?: ReviewedAppToolExecutors
  input?: GenericReviewedAppToolInput
  executionOptions?: ToolExecutionOptions
}) {
  const tools = wrapChatBridgeHostTools(createReviewedToolsForSelection(options.selection, options.executors), {
    sessionId: options.sessionId,
  })
  const tool = tools[options.selection.toolName]
  const execute = tool?.execute
  if (typeof execute !== 'function') {
    throw new Error(`Reviewed tool "${options.selection.toolName}" is unavailable for "${options.selection.appId}".`)
  }

  const result = await execute(
    options.input ?? buildReviewedSelectionInput(options.selection),
    options.executionOptions ?? {
      toolCallId: `${options.selection.appId}-route-selection`,
      messages: [],
    }
  )

  if (!isChatBridgeHostToolExecutionRecord(result)) {
    throw new Error(`Reviewed tool "${options.selection.toolName}" did not return a host execution record.`)
  }

  return result
}

export function createReviewedSingleAppToolSet(
  options: CreateReviewedSingleAppToolSetOptions
): ReviewedSingleAppToolSetResult {
  const entries = options.entries ?? ensureDefaultReviewedAppsRegistered()
  const promptText = getLatestUserPrompt(options.messages)
  const contextInput = mergeReviewedAppContextInput(options.contextInput)
  const hostRuntime = resolveHostRuntimeFromContextInput(contextInput)
  const { decision: routeDecision } = getReviewedAppRouteDecision({
    promptInput: promptText,
    contextInput,
    entries,
  })

  const routeSelection = createSelectionFromRouteDecision(routeDecision, entries)
  if (routeSelection) {
    return {
      selection: routeSelection,
      tools: createToolsForSelection(routeSelection, options.executors),
      routeDecision,
      selectionSource: 'route-decision',
    }
  }

  const runtimeSupportedEntries = entries.filter((entry) => isReviewedAppSupportedOnHostRuntime(entry, hostRuntime))
  const fallbackSelection = resolveReviewedSingleAppSelection(options.messages, runtimeSupportedEntries)
  const selectionSource = fallbackSelection.status === 'matched' ? 'natural-chess-fallback' : 'none'
  const suppressRouteArtifact =
    fallbackSelection.status !== 'matched' && shouldSuppressActiveAppRouteArtifact(options.messages, routeDecision)

  return {
    selection: fallbackSelection,
    tools: createToolsForSelection(fallbackSelection, options.executors),
    routeDecision,
    selectionSource,
    suppressRouteArtifact,
  }
}
