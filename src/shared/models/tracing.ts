import type { ModelMessage, ToolSet } from 'ai'
import {
  createNoopLangSmithAdapter,
  getLangSmithErrorMessage,
  type LangSmithAdapter,
  type LangSmithTraceContext,
} from '../utils/langsmith_adapter'
import type { StreamTextResult } from '../types'
import type {
  CallChatCompletionOptions,
  ChatStreamOptions,
  ModelInterface,
  ModelStreamPart,
  PaintOptions,
} from './types'

export const CHATBRIDGE_LANGSMITH_PROJECT_NAME = 'chatbox-chatbridge'

export type ChatBridgeTraceEvidenceFamily =
  | 'auth-resource'
  | 'board-context'
  | 'bridge'
  | 'catalog'
  | 'persistence'
  | 'recovery'
  | 'reviewed-app-launch'
  | 'routing'

export type ChatBridgeTraceSurface = 'eval' | 'manual_smoke'
export type ChatBridgeTraceRuntimeTarget = 'desktop-electron' | 'integration-vitest'
export type ChatBridgeTraceSmokeSupport = 'legacy-reference' | 'scenario-only' | 'supported'

export interface ChatBridgeTraceDescriptor {
  slug: string
  surface: ChatBridgeTraceSurface
  primaryFamily: ChatBridgeTraceEvidenceFamily
  evidenceFamilies?: ChatBridgeTraceEvidenceFamily[]
  storyId?: string
  legacy?: boolean
  runtimeTarget?: ChatBridgeTraceRuntimeTarget
  smokeSupport?: ChatBridgeTraceSmokeSupport
}

const TRACE_WRAPPED_MODEL_SYMBOL = Symbol.for('chatbox.langsmith.traced-model')

function sanitizeTraceSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function dedupeTraceFamilies(descriptor: ChatBridgeTraceDescriptor) {
  return Array.from(new Set([descriptor.primaryFamily, ...(descriptor.evidenceFamilies ?? [])]))
}

function resolveTraceRuntimeTarget(descriptor: ChatBridgeTraceDescriptor): ChatBridgeTraceRuntimeTarget {
  return descriptor.runtimeTarget ?? (descriptor.surface === 'eval' ? 'integration-vitest' : 'desktop-electron')
}

function resolveTraceSmokeSupport(descriptor: ChatBridgeTraceDescriptor): ChatBridgeTraceSmokeSupport {
  if (descriptor.smokeSupport) {
    return descriptor.smokeSupport
  }

  if (descriptor.surface === 'eval') {
    return 'scenario-only'
  }

  return descriptor.legacy ? 'legacy-reference' : 'supported'
}

export function createChatBridgeTraceName(descriptor: ChatBridgeTraceDescriptor, uniqueSuffix?: string) {
  const prefix = descriptor.surface === 'eval' ? 'chatbridge.eval' : 'chatbridge.manual_smoke'
  const suffix = uniqueSuffix ? `.${sanitizeTraceSegment(uniqueSuffix)}` : ''

  return `${prefix}.${sanitizeTraceSegment(descriptor.slug)}${suffix}`
}

export function createChatBridgeTraceMetadata(
  descriptor: ChatBridgeTraceDescriptor,
  metadata: Record<string, unknown> = {}
) {
  return {
    product: 'chatbridge',
    surface: descriptor.surface,
    primaryFamily: descriptor.primaryFamily,
    evidenceFamilies: dedupeTraceFamilies(descriptor),
    storyId: descriptor.storyId ?? 'CB-006',
    legacy: descriptor.legacy ?? false,
    runtimeTarget: resolveTraceRuntimeTarget(descriptor),
    smokeSupport: resolveTraceSmokeSupport(descriptor),
    ...metadata,
  }
}

export function createChatBridgeTraceTags(descriptor: ChatBridgeTraceDescriptor, tags: string[] = []) {
  return Array.from(
    new Set([
      'chatbridge',
      descriptor.surface === 'eval' ? 'eval' : 'manual-smoke',
      ...dedupeTraceFamilies(descriptor),
      descriptor.legacy ? 'legacy' : 'active',
      descriptor.storyId?.toLowerCase() ?? 'cb-006',
      `runtime-target:${resolveTraceRuntimeTarget(descriptor)}`,
      `smoke-support:${resolveTraceSmokeSupport(descriptor)}`,
      ...tags,
    ])
  )
}

function summarizeMessageContent(content: ModelMessage['content']) {
  if (typeof content === 'string') {
    return content.slice(0, 240)
  }

  if (!Array.isArray(content)) {
    return '[unsupported-content]'
  }

  return content.map((part) => {
    if (part.type === 'text') {
      return {
        type: 'text',
        text: part.text.slice(0, 240),
      }
    }

    if (part.type === 'image') {
      return {
        type: 'image',
      }
    }

    if (part.type === 'file') {
      return {
        type: 'file',
        mediaType: part.mediaType ?? 'unknown',
      }
    }

    return {
      type: part.type,
    }
  })
}

function summarizeModelMessages(messages: ModelMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: summarizeMessageContent(message.content),
  }))
}

function summarizeProviderOptions(providerOptions: CallChatCompletionOptions['providerOptions']) {
  if (!providerOptions) {
    return undefined
  }

  return Object.fromEntries(
    Object.entries(providerOptions).map(([providerName, options]) => [providerName, Object.keys(options ?? {}).sort()])
  )
}

function summarizeStreamTextResult(result: StreamTextResult) {
  const textPreview =
    result.contentParts
      ?.filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('')
      .slice(0, 240) ?? ''

  return {
    textPreview,
    contentPartTypes: Array.from(new Set(result.contentParts?.map((part) => part.type) ?? [])),
    outputTokens: result.usage?.outputTokens ?? null,
    totalTokens: result.usage?.totalTokens ?? null,
    finishReason: result.finishReason ?? null,
  }
}

function summarizePaintParams(params: PaintOptions) {
  return {
    prompt: params.prompt.slice(0, 240),
    imageCount: params.images?.length ?? 0,
    num: params.num,
    aspectRatio: params.aspectRatio ?? 'auto',
  }
}

function resolveTraceName(
  model: ModelInterface,
  operation: 'chat' | 'chatStream' | 'paint',
  context?: LangSmithTraceContext
) {
  if (context?.name) {
    return context.name
  }

  return `${model.name}.${operation}`
}

function buildTraceMetadata(
  model: ModelInterface,
  context: LangSmithTraceContext | undefined,
  extra: Record<string, unknown> = {}
) {
  return {
    modelId: model.modelId,
    modelName: model.name,
    ...context?.metadata,
    ...extra,
  }
}

function buildChatInputs(messages: ModelMessage[], options: CallChatCompletionOptions | ChatStreamOptions) {
  return {
    messages: summarizeModelMessages(messages),
    toolNames: options.tools ? Object.keys(options.tools).sort() : [],
    maxSteps: options.maxSteps ?? null,
    providerOptions: summarizeProviderOptions(options.providerOptions),
    sessionId: options.sessionId ?? null,
  }
}

export function wrapModelWithLangSmith(
  model: ModelInterface,
  adapter: LangSmithAdapter = createNoopLangSmithAdapter()
) {
  if (!adapter.enabled || (model as unknown as Record<PropertyKey, unknown>)[TRACE_WRAPPED_MODEL_SYMBOL]) {
    return model
  }

  const wrapped = new Proxy(model, {
    get(target, prop, receiver) {
      if (prop === TRACE_WRAPPED_MODEL_SYMBOL) {
        return true
      }

      if (prop === 'chat') {
        return async (messages: ModelMessage[], options: CallChatCompletionOptions<ToolSet> = {}) => {
          const traceContext = options.traceContext
          const run = await adapter.startRun({
            name: resolveTraceName(target, 'chat', traceContext),
            runType: 'llm',
            parentRunId: traceContext?.parentRunId,
            inputs: buildChatInputs(messages, options),
            metadata: buildTraceMetadata(target, traceContext, {
              operation: 'chat',
            }),
            tags: ['model', ...(traceContext?.tags ?? [])],
          })

          try {
            const result = await target.chat.call(target, messages, options)
            await run.end({
              outputs: summarizeStreamTextResult(result),
            })
            return result
          } catch (error) {
            await run.end({
              error: getLangSmithErrorMessage(error),
            })
            throw error
          }
        }
      }

      if (prop === 'chatStream') {
        return async function* <T extends ToolSet>(messages: ModelMessage[], options: ChatStreamOptions = {}) {
          const traceContext = options.traceContext
          const run = await adapter.startRun({
            name: resolveTraceName(target, 'chatStream', traceContext),
            runType: 'llm',
            parentRunId: traceContext?.parentRunId,
            inputs: buildChatInputs(messages, options),
            metadata: buildTraceMetadata(target, traceContext, {
              operation: 'chatStream',
            }),
            tags: ['model', 'stream', ...(traceContext?.tags ?? [])],
          })
          const textDeltas: string[] = []
          const partTypes = new Set<string>()

          try {
            for await (const chunk of target.chatStream.call(target, messages, options) as AsyncGenerator<
              ModelStreamPart<T>
            >) {
              partTypes.add(chunk.type)
              if (chunk.type === 'text-delta') {
                textDeltas.push(chunk.text)
              }
              yield chunk
            }
            await run.end({
              outputs: {
                partTypes: Array.from(partTypes),
                textPreview: textDeltas.join('').slice(0, 240),
              },
            })
          } catch (error) {
            await run.end({
              error: getLangSmithErrorMessage(error),
            })
            throw error
          }
        }
      }

      if (prop === 'paint') {
        return async (
          params: PaintOptions,
          signal?: AbortSignal,
          callback?: (picBase64: string) => void | Promise<void>
        ) => {
          const traceContext = params.traceContext
          const run = await adapter.startRun({
            name: resolveTraceName(target, 'paint', traceContext),
            runType: 'llm',
            parentRunId: traceContext?.parentRunId,
            inputs: summarizePaintParams(params),
            metadata: buildTraceMetadata(target, traceContext, {
              operation: 'paint',
            }),
            tags: ['model', 'image-generation', ...(traceContext?.tags ?? [])],
          })

          try {
            const result = await target.paint.call(target, params, signal, callback)
            await run.end({
              outputs: {
                imageCount: result.length,
              },
            })
            return result
          } catch (error) {
            await run.end({
              error: getLangSmithErrorMessage(error),
            })
            throw error
          }
        }
      }

      return Reflect.get(target, prop, receiver)
    },
  })

  return wrapped as ModelInterface
}
