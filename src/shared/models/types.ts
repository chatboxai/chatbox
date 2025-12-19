import type { ModelMessage, ToolSet } from 'ai'
import {
  type MessageContentParts,
  type ProviderOptions,
  ProviderOptionsSchema,
  type StreamTextResult,
  type ToolUseScope,
} from 'src/shared/types'
import { z } from 'zod'

export interface ModelInterface {
  name: string
  modelId: string
  isSupportVision(): boolean
  isSupportToolUse(scope?: ToolUseScope): boolean
  isSupportSystemMessage(): boolean
  chat: (messages: ModelMessage[], options: CallChatCompletionOptions) => Promise<StreamTextResult>
  paint: (
    params: {
      prompt: string
      images?: { imageUrl: string }[]
      num: number
    },
    signal?: AbortSignal,
    callback?: (picBase64: string) => void
  ) => Promise<string[]>
}

export const CallChatCompletionOptionsSchema = z.object({
  sessionId: z.string().optional(),
  signal: z.instanceof(AbortSignal).optional(),
  onResultChange: z.custom<OnResultChange>().optional(),
  tools: z.custom<ToolSet>().optional(),
  providerOptions: ProviderOptionsSchema.optional(),
})

export interface CallChatCompletionOptions<Tools extends ToolSet = ToolSet> {
  sessionId?: string
  signal?: AbortSignal
  onResultChange?: OnResultChange
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
