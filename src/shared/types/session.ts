import type { LanguageModelUsage } from 'ai'
import { z } from 'zod'
import { SessionSettingsSchema } from '../types/settings'
import { ModelProviderEnum } from './provider'

// Re-export for backward compatibility
export { ModelProviderEnum } from './provider'

// Token cache key schema
export const TokenCacheKeySchema = z.enum(['default', 'deepseek'])
export type TokenCacheKey = z.infer<typeof TokenCacheKeySchema>

// Export the enum values directly for easy access
export const TOKEN_CACHE_KEYS = TokenCacheKeySchema.enum

// Token count map schema
export const TokenCountMapSchema = z.record(TokenCacheKeySchema, z.number())

export type TokenCountMap = z.infer<typeof TokenCountMapSchema>

// Search result schemas
export const SearchResultItemSchema = z.object({
  title: z.string(),
  link: z.string(),
  snippet: z.string(),
  rawContent: z.string().nullable().optional(),
})

export const SearchResultSchema = z.object({
  items: z.array(SearchResultItemSchema),
})

// Message file schemas
export const MessageFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  fileType: z.string(),
  url: z.string().optional(),
  storageKey: z.string().optional(),
  chatboxAIFileUUID: z.string().optional(),
  tokenCountMap: TokenCountMapSchema.optional().catch(undefined),
})

export const MessageLinkSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  storageKey: z.string().optional(),
  chatboxAILinkUUID: z.string().optional(),
  tokenCountMap: TokenCountMapSchema.optional(),
})

export const MessagePictureSchema = z.object({
  url: z.string().optional(),
  storageKey: z.string().optional(),
  loading: z.boolean().optional(),
})

export const MessageRoleEnum = {
  System: 'system',
  User: 'user',
  Assistant: 'assistant',
  Tool: 'tool',
} as const

export type MessageRole = (typeof MessageRoleEnum)[keyof typeof MessageRoleEnum]

// Message content part schemas
export const MessageTextPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
})

export const MessageImagePartSchema = z.object({
  type: z.literal('image'),
  storageKey: z.string(),
  ocrResult: z.string().optional(),
})

export const MessageInfoPartSchema = z.object({
  type: z.literal('info'),
  text: z.string(),
  values: z.record(z.string(), z.unknown()).optional(),
})

export const MessageReasoningPartSchema = z.object({
  type: z.literal('reasoning'),
  text: z.string(),
  startTime: z.number().optional(),
  duration: z.number().optional(),
})

export const MessageToolCallPartSchema = z.object({
  type: z.literal('tool-call'),
  state: z.enum(['call', 'result', 'error']),
  toolCallId: z.string(),
  toolName: z.string(),
  args: z.unknown(),
  result: z.unknown().optional(),
})

export const MessageContentPartSchema = z.discriminatedUnion('type', [
  MessageTextPartSchema,
  MessageImagePartSchema,
  MessageInfoPartSchema,
  MessageReasoningPartSchema,
  MessageToolCallPartSchema,
])

export const MessageContentPartsSchema = z.array(MessageContentPartSchema)

export const StreamTextResultSchema = z.object({
  contentParts: MessageContentPartsSchema,
  reasoningContent: z.string().optional(),
  usage: z.custom<LanguageModelUsage>().optional(),
  finishReason: z.string().optional(),
})

// Tool and provider schemas
export const ToolUseScopeSchema = z.enum(['web-browsing', 'knowledge-base'])

export const ModelProviderSchema = z.union([z.nativeEnum(ModelProviderEnum), z.string()])

// Message status schemas
export const MessageStatusSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('sending_file'),
    mode: z.enum(['local', 'advanced']).optional(),
  }),
  z.object({
    type: z.literal('loading_webpage'),
    mode: z.enum(['local', 'advanced']).optional(),
  }),
])

// Main Message schema
// Define a custom function type for cancel
const CancelFunctionSchema = z.custom<(() => void) | undefined>(
  (val) => val === undefined || typeof val === 'function',
  { message: 'Must be a function or undefined' }
)

const MessageUsageSchema = z.object({
  inputTokens: z.number().optional().catch(undefined),
  /**
  The number of output (completion) tokens used.
     */
  outputTokens: z.number().optional().catch(undefined),
  /**
  The total number of tokens as reported by the provider.
  This number might be different from the sum of `inputTokens` and `outputTokens`
  and e.g. include reasoning tokens or other overhead.
     */
  totalTokens: z.number().optional().catch(undefined),
  /**
  The number of reasoning tokens used.
     */
  reasoningTokens: z.number().optional().catch(undefined),
  /**
  The number of cached input tokens.
     */
  cachedInputTokens: z.number().optional().catch(undefined),
})

export const MessageSchema = z.object({
  id: z.string(),
  role: z.nativeEnum(MessageRoleEnum),
  name: z.string().optional(),
  cancel: CancelFunctionSchema.optional(),
  generating: z.boolean().optional(),
  aiProvider: z.union([ModelProviderSchema, z.string()]).optional(),
  model: z.string().optional(),
  style: z.string().optional(),
  files: z.array(MessageFileSchema).optional(),
  links: z.array(MessageLinkSchema).optional(),
  reasoningContent: z.string().optional().describe('deprecated, moved to contentParts'),
  contentParts: MessageContentPartsSchema,
  isStreamingMode: z.boolean().optional(),
  errorCode: z.number().optional(),
  error: z.string().optional(),
  errorExtra: z.record(z.string(), z.unknown()).optional(),
  status: z.array(MessageStatusSchema).optional(),
  wordCount: z.number().optional(),
  tokenCount: z.number().optional(), // output token count
  tokensUsed: z.number().optional(), // deprecated, use `usage` instead
  usage: MessageUsageSchema.optional().catch(undefined),
  timestamp: z.number().optional(),
  firstTokenLatency: z.number().optional(),
  finishReason: z.string().optional(),
  tokenCountMap: TokenCountMapSchema.optional(), // estimate token count as input
})

// Session schemas
export const SessionTypeSchema = z.enum(['chat', 'picture'])

export const MessageForkListSchema = z.object({
  id: z.string(),
  messages: z.array(MessageSchema),
})

export const MessageForkSchema = z.object({
  position: z.number(),
  lists: z.array(MessageForkListSchema),
  createdAt: z.number(),
})

export const SessionThreadSchema = z.object({
  id: z.string(),
  name: z.string(),
  messages: z.array(MessageSchema),
  createdAt: z.number(),
})

export const SessionSchema = z.object({
  id: z.string(),
  type: SessionTypeSchema.optional(),
  name: z.string(),
  picUrl: z.string().optional(),
  messages: z.array(MessageSchema),
  starred: z.boolean().optional(),
  copilotId: z.string().optional(),
  assistantAvatarKey: z.string().optional(),
  settings: SessionSettingsSchema.optional(),
  threads: z.array(SessionThreadSchema).optional(),
  threadName: z.string().optional(),
  messageForksHash: z.record(z.string(), MessageForkSchema).optional(),
})

export const SessionMetaSchema = SessionSchema.pick({
  id: true,
  name: true,
  starred: true,
  assistantAvatarKey: true,
  picUrl: true,
  type: true,
})

export const SessionThreadBriefSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number().optional(),
  createdAtLabel: z.string().optional(),
  firstMessageId: z.string(),
  messageCount: z.number(),
})

// Export types inferred from schemas
export type SearchResultItem = z.infer<typeof SearchResultItemSchema>
export type SearchResult = z.infer<typeof SearchResultSchema>
export type MessageFile = z.infer<typeof MessageFileSchema>
export type MessageLink = z.infer<typeof MessageLinkSchema>
export type MessagePicture = z.infer<typeof MessagePictureSchema>
export type MessageTextPart = z.infer<typeof MessageTextPartSchema>
export type MessageImagePart = z.infer<typeof MessageImagePartSchema>
export type MessageInfoPart = z.infer<typeof MessageInfoPartSchema>
export type MessageReasoningPart = z.infer<typeof MessageReasoningPartSchema>
export type MessageToolCallPart<Args = unknown, Result = unknown> = z.infer<typeof MessageToolCallPartSchema> & {
  args: Args
  result?: Result
}
export type MessageContentParts = z.infer<typeof MessageContentPartsSchema>
export type StreamTextResult = z.infer<typeof StreamTextResultSchema>
export type ToolUseScope = z.infer<typeof ToolUseScopeSchema>
export type ModelProvider = z.infer<typeof ModelProviderSchema>
export type Message = z.infer<typeof MessageSchema>
export type SessionType = z.infer<typeof SessionTypeSchema>
export type Session = z.infer<typeof SessionSchema>
export type SessionMeta = z.infer<typeof SessionMetaSchema>
export type SessionThread = z.infer<typeof SessionThreadSchema>
export type SessionThreadBrief = z.infer<typeof SessionThreadBriefSchema>
