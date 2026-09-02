import type { JSONValue, ModelMessage, PrepareStepFunction, TextStreamPart, ToolSet } from 'ai'
import {
  type MessageContentParts,
  type MessageStatus,
  type ProviderModelInfo,
  type ProviderOptions,
  ProviderOptionsSchema,
  type StreamTextResult,
  type ToolUseScope,
} from 'src/shared/types'
import { z } from 'zod'

export interface ModelInterface {
  name: string
  modelId: string
  /**
   * Resolved API family of this model instance. getModel() stamps it from the provider
   * type (builtin/custom providers) or the per-model remote config (ChatboxAI).
   */
  readonly apiStyle?: ProviderModelInfo['apiStyle']
  isSupportVision(): boolean
  isSupportToolUse(scope?: ToolUseScope): boolean
  isSupportSystemMessage(): boolean
  chat: (messages: ModelMessage[], options: CallChatCompletionOptions) => Promise<StreamTextResult>
  chatStream: (messages: ModelMessage[], options: ChatStreamOptions) => AsyncGenerator<ModelStreamPart>
  /** Apply model-specific normalization after a streamed response has completed. */
  normalizeCompletedResponse: (
    contentParts: MessageContentParts,
    finishReason: string | undefined
  ) => MessageContentParts
  paint: (
    params: {
      prompt: string
      images?: { imageUrl: string }[]
      num: number
      aspectRatio?: string
    },
    signal?: AbortSignal,
    callback?: (picBase64: string) => void | Promise<void>
  ) => Promise<string[]>
}

/** The exact provider-facing settings after model-specific normalization. */
export interface CallSettings {
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  providerOptions?: Record<string, Record<string, JSONValue>>
  system?: string
}

export interface ResolvedChatRequest {
  callSettings: CallSettings
  modelMessages: ModelMessage[]
  tools: ToolSet
  stream: boolean
}

export const CallChatCompletionOptionsSchema = z.object({
  sessionId: z.string().optional(),
  agentMode: z.boolean().optional(),
  signal: z.instanceof(AbortSignal).optional(),
  onResultChange: z.custom<OnResultChange>().optional(),
  tools: z.custom<ToolSet>().optional(),
  providerOptions: ProviderOptionsSchema.optional(),
})

export interface CallChatCompletionOptions<Tools extends ToolSet = ToolSet> {
  sessionId?: string
  /** Whether Agent/Work Mode capabilities are active for this request. */
  agentMode?: boolean
  signal?: AbortSignal
  onResultChange?: OnResultChange
  onStatusChange?: OnStatusChange
  tools?: Tools
  providerOptions?: ProviderOptions
  maxSteps?: number
}

export interface ResultChange {
  // webBrowsing?: MessageWebBrowsing
  // reasoningContent?: string
  // toolCalls?: MessageToolCalls
  contentParts?: MessageContentParts
  tokenCount?: number // 当前消息的 token 数量
  tokensUsed?: number // 生成当前消息的 token 使用量
}

export type OnResultChangeWithCancel = (data: ResultChange & { cancel?: () => void }) => void
export type OnResultChange = (data: ResultChange) => void
export type OnStatusChange = (status: MessageStatus | null) => void

// New types for chatStream() API
export interface ChatStreamOptions {
  sessionId?: string
  /** Whether Agent/Work Mode capabilities are active for this request. */
  agentMode?: boolean
  signal?: AbortSignal
  tools?: ToolSet
  providerOptions?: ProviderOptions
  maxSteps?: number
  prepareStep?: PrepareStepFunction<ToolSet>
  /**
   * Runs after each step's preparation resolves provider-facing messages/tools
   * and before dispatch. **Fail-closed**: the hook is awaited and a rejection
   * propagates instead of starting the provider stream. A consumer that must
   * not block dispatch (request logging, telemetry) has to swallow its own
   * failures.
   */
  onRequestResolved?: (request: ResolvedChatRequest) => void | Promise<void>
  /**
   * Enables mid-run tool-result relief for long tool loops: when the estimated
   * step payload approaches `thresholdTokens` (the compaction threshold), old
   * tool-result outputs are stubbed between steps. See context-pressure-relief.
   */
  contextPressure?: { thresholdTokens: number }
}

export type ModelStatus = MessageStatus

// ModelStreamPart extends AI SDK's TextStreamPart with custom status events
export type ModelStreamPart<T extends ToolSet = ToolSet> = TextStreamPart<T> | { type: 'status'; status: MessageStatus }
