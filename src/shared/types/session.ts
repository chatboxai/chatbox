import type { JSONValue, LanguageModelUsage, ProviderMetadata } from 'ai'
import { z } from 'zod'
import { SessionSettingsSchema } from '../types/settings'
import { SessionPromptContextSnapshotSchema } from './agent-persona'
import { ModelProviderEnum } from './provider'

// Re-export for backward compatibility
export { ModelProviderEnum } from './provider'

// Token cache key schema
export const TokenCacheKeySchema = z.enum(['default', 'deepseek', 'default_preview', 'deepseek_preview'])
export type TokenCacheKey = z.infer<typeof TokenCacheKeySchema>

// Export the enum values directly for easy access
export const TOKEN_CACHE_KEYS = TokenCacheKeySchema.enum

// Token count map schema - use passthrough to allow any string keys for backward compatibility
export const TokenCountMapSchema = z.record(z.string(), z.number())

export type TokenCountMap = z.infer<typeof TokenCountMapSchema>

// Token calculated at schema - timestamp for each tokenizer type
export const TokenCalculatedAtSchema = z
  .object({
    default: z.number().optional(),
    deepseek: z.number().optional(),
    default_preview: z.number().optional(),
    deepseek_preview: z.number().optional(),
  })
  .optional()

export type TokenCalculatedAt = z.infer<typeof TokenCalculatedAtSchema>

// Marks tokenizer entries whose count is a sampling fallback rather than an
// exact encode (e.g. the tokenizer worker was unavailable). Absent for exact
// entries and for historical data, which is always exact.
export const TokenCountApproximateSchema = z
  .object({
    default: z.boolean().optional(),
    deepseek: z.boolean().optional(),
    default_preview: z.boolean().optional(),
    deepseek_preview: z.boolean().optional(),
  })
  .optional()

export type TokenCountApproximate = z.infer<typeof TokenCountApproximateSchema>

// Search result schemas
export const SearchResultItemSchema = z.object({
  title: z.string(),
  link: z.string(),
  snippet: z.string(),
})

export const SearchResultSchema = z.object({
  items: z.array(SearchResultItemSchema),
})

// Message file schemas
export const MessageFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  fileType: z.string(),
  parserType: z.string().optional(),
  url: z.string().optional(),
  storageKey: z.string().optional(),
  localPath: z.string().optional(),
  rawStorageKey: z.string().optional(),
  chatboxAIFileUUID: z.string().optional(),
  ragMode: z.enum(['inline', 'session-retrieval']).optional(),
  sessionAttachmentId: z.number().optional(),
  sessionAttachmentAvailability: z.enum(['allowed', 'blocked']).optional(),
  sessionAttachmentIndexStatus: z.enum(['pending', 'indexing', 'ready', 'failed']).optional(),
  sessionAttachmentBlockedReason: z.string().optional(),
  sessionAttachmentWarningReason: z.string().optional(),
  sessionAttachmentStatus: z.enum(['pending', 'indexing', 'ready', 'failed']).optional(),
  sessionAttachmentChunkCount: z.number().optional(),
  sessionAttachmentIndexingStage: z.enum(['queued', 'chunking', 'embedding', 'finalizing', 'ready']).optional(),
  sessionAttachmentTotalChunks: z.number().optional(),
  sessionAttachmentEmbeddedChunks: z.number().optional(),
  tokenCountMap: TokenCountMapSchema.optional().catch(undefined),
  tokenCalculatedAt: TokenCalculatedAtSchema,
  lineCount: z.number().optional(),
  byteLength: z.number().optional(),
})

export const MessageLinkSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  storageKey: z.string().optional(),
  chatboxAILinkUUID: z.string().optional(),
  tokenCountMap: TokenCountMapSchema.optional(),
  tokenCalculatedAt: TokenCalculatedAtSchema,
  lineCount: z.number().optional(),
  byteLength: z.number().optional(),
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

// Mirrors the AI SDK `ProviderMetadata` shape (provider → key → JSONValue). The inner
// `.optional()` is required for assignability to `z.ZodType<ProviderMetadata>` because the
// SDK's JSONObject values admit `undefined`.
const MessageProviderMetadataSchema: z.ZodType<ProviderMetadata> = z.record(
  z.string(),
  z.record(z.string(), z.custom<JSONValue>().optional())
)

// Message content part schemas
export const MessageTextPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
  /**
   * The part exists only to keep the provider's block structure intact for
   * request replay (e.g. an empty Anthropic text block between thinking
   * blocks). Never rendered, exported, or counted as a work step.
   */
  protocolOnly: z.literal(true).optional(),
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

export const MessageAgentModeSuggestionPartSchema = z.object({
  type: z.literal('agent-mode-suggestion'),
  reason: z.string().optional(),
})

export const MessageReasoningPartSchema = z.object({
  type: z.literal('reasoning'),
  text: z.string(),
  /**
   * Replay-critical provider metadata (whitelisted in
   * `models/provider-part-metadata.ts`), e.g. Anthropic thinking signatures and
   * redacted thinking payloads required to resume a paused tool-use turn.
   */
  providerMetadata: MessageProviderMetadataSchema.optional(),
  /**
   * The part carries only protocol replay data and no visible reasoning text
   * (e.g. Anthropic `redacted_thinking`, or a signed empty thinking block).
   * Never rendered, exported, or counted as a work step.
   */
  protocolOnly: z.literal(true).optional(),
  startTime: z.number().optional(),
  duration: z.number().optional(),
})

export const ImageGenerationApprovalDetailsSchema = z.object({
  type: z.literal('image_generation'),
  provider: z.string(),
  modelId: z.string(),
  prompt: z.string(),
  count: z.number(),
  aspectRatio: z.string().optional(),
  style: z.enum(['vivid', 'natural']).optional(),
  billing: z.enum(['chatbox_quota', 'provider']),
  imageQuota: z
    .object({
      remaining: z.number(),
      total: z.number(),
    })
    .optional(),
  computePointsRemainingRatio: z.number().optional(),
  // Backward compatibility for approvals persisted by early virtual-CLI builds.
  computePointsRemaining: z.number().optional(),
})

export const AppActionApprovalDetailsSchema = z.discriminatedUnion('type', [ImageGenerationApprovalDetailsSchema])

/**
 * Line counts for a pending file mutation. `mode` tells the UI whether to show
 * an edit delta (`+N -M`) or the number of lines in a whole-file write.
 */
export const FileMutationApprovalStatsSchema = z.object({
  mode: z.enum(['write', 'edit']).catch('edit'),
  /** Number of search-and-replace edits in the call; absent for a whole-file write. */
  edits: z.number().optional(),
  addedLines: z.number(),
  removedLines: z.number(),
})

export const MessageToolCallPartSchema = z.object({
  type: z.literal('tool-call'),
  state: z.enum(['call', 'result', 'error', 'paused']),
  toolCallId: z.string(),
  toolName: z.string(),
  args: z.unknown().optional(),
  providerMetadata: MessageProviderMetadataSchema.optional().catch(undefined),
  resultProviderMetadata: MessageProviderMetadataSchema.optional().catch(undefined),
  providerExecuted: z.boolean().optional(),
  /**
   * Generation step this call was emitted in. Tool calls sharing a stepIndex are one
   * provider-level parallel batch (Gemini 3 signs only the first functionCall of a batch).
   */
  stepIndex: z.number().optional().catch(undefined),
  result: z.unknown().optional(),
  /** Timestamp (ms) when this tool call started executing. */
  startTime: z.number().optional(),
  /** How long (ms) this tool call took from start to result/error. */
  duration: z.number().optional(),
  pauseReason: z
    .discriminatedUnion('type', [
      z.object({
        type: z.literal('tool_call_limit'),
        maxToolCalls: z.number(),
      }),
      z.object({
        type: z.literal('user_exec_approval'),
        command: z.string(),
        explanation: z.string().optional(),
        explanationError: z.boolean().optional(),
        workdir: z.string().optional(),
      }),
      z.object({
        type: z.literal('command_escalation_approval'),
        command: z.string(),
        retryOf: z.string(),
        justification: z.string(),
        workdir: z.string(),
      }),
      z.object({
        type: z.literal('file_mutation_approval'),
        title: z.string(),
        preview: z.string(),
        /**
         * Change magnitude, computed from the untruncated tool arguments so the
         * approval bar can summarize instead of rendering the whole preview.
         * Absent on approvals paused by builds before this existed.
         */
        stats: FileMutationApprovalStatsSchema.optional().catch(undefined),
      }),
      z.object({
        type: z.literal('app_action_approval'),
        action: z.string(),
        title: z.string(),
        preview: z.string(),
        details: AppActionApprovalDetailsSchema.optional(),
      }),
    ])
    .optional(),
  /** When the original result exceeded the size limit, the full result is stored in blob storage under this key. */
  resultStorageKey: z.string().optional(),
  /** Image produced by this tool result, promoted out of private result JSON for generic consumers. */
  resultImageStorageKey: z.string().optional(),
  resultImageMediaType: z.string().optional(),
})

export const MessageContentPartSchema = z.discriminatedUnion('type', [
  MessageTextPartSchema,
  MessageImagePartSchema,
  MessageInfoPartSchema,
  MessageAgentModeSuggestionPartSchema,
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
export const ToolUseScopeSchema = z.enum(['agent', 'web-browsing', 'knowledge-base', 'read-file'])

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
  z.object({
    type: z.literal('retrying'),
    attempt: z.number(),
    maxAttempts: z.number(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal('preparing_tool_call'),
    toolName: z.string().optional(),
    progress: z
      .object({
        kind: z.enum(['size_kb', 'lines']),
        value: z.number(),
      })
      .optional(),
  }),
])

export const MessageBackgroundTaskSchema = z.object({
  id: z.string(),
  type: z.literal('image_generation'),
  status: z.enum(['completed', 'failed']),
  recordId: z.string(),
  startedAt: z.number(),
  finishedAt: z.number(),
  elapsedMs: z.number(),
  summary: z.string(),
})

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
  generating: z.boolean().optional(),
  aiProvider: z.union([ModelProviderSchema, z.string()]).optional(),
  /** Display name of the generating model (e.g. "Claude API (claude-sonnet-4-6)"), for the UI only. */
  model: z.string().optional(),
  /**
   * Raw model id of the generating model (`settings.modelId`). Display names
   * are neither stable nor parseable, so this is the machine-readable
   * provenance record for a message.
   */
  modelId: z.string().optional(),
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
  /** App-generated wake-up metadata. The message remains user-role for model turn sequencing. */
  backgroundTask: MessageBackgroundTaskSchema.optional(),
  /** User message injected mid-generation via queue jumping (steering). */
  steered: z.boolean().optional(),
  wordCount: z.number().optional(),
  tokenCount: z.number().optional(), // output token count
  tokensUsed: z.number().optional(), // deprecated, use `usage` instead
  usage: MessageUsageSchema.optional().catch(undefined),
  timestamp: z.number().optional(),
  firstTokenLatency: z.number().optional(),
  /** Total wall-clock time (ms) spent generating this message (thinking + tools + text). */
  generationDuration: z.number().optional(),
  finishReason: z.string().optional(),
  tokenCountMap: TokenCountMapSchema.optional(), // estimate token count as input
  tokenCalculatedAt: TokenCalculatedAtSchema,
  tokenCountApproximate: TokenCountApproximateSchema,
  updatedAt: z.number().optional(),
  isSummary: z.boolean().optional(), // Marks message as a compaction summary
  isForkMarker: z.boolean().optional(), // Marks a UI-only fork boundary message
  forkedFromSessionId: z.string().optional(),
})

// Compaction point schema (for context management)
export const CompactionPointSchema = z.object({
  summaryMessageId: z.string(),
  boundaryMessageId: z.string(),
  createdAt: z.number(),
})

// Session schemas
export const SessionTypeSchema = z.enum(['chat', 'picture', 'guide'])

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
  compactionPoints: z.array(CompactionPointSchema).optional(),
  // The frozen session prompt-context snapshot travels with its conversation, like
  // compaction points: an archived thread restored later keeps the exact
  // Soul/memories it was generated with instead of recapturing the latest.
  sessionPromptContextSnapshot: SessionPromptContextSnapshotSchema.optional().catch(undefined),
})

// Image source schema
export const ImageSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('url'), url: z.string() }),
  z.object({ type: z.literal('storage-key'), storageKey: z.string() }),
])

export const SessionSchema = z.object({
  id: z.string(),
  type: SessionTypeSchema.optional(),
  name: z.string(),
  picUrl: z.string().optional(),
  messages: z.array(MessageSchema),
  starred: z.boolean().optional(),
  hidden: z.boolean().optional(), // Hidden from session list (e.g., migrated picture sessions)
  archivedAt: z.number().optional(),
  copilotId: z.string().optional(),
  assistantAvatarKey: z.string().optional(),
  backgroundImage: ImageSourceSchema.optional(),
  settings: SessionSettingsSchema.optional(),
  threads: z.array(SessionThreadSchema).optional(),
  threadName: z.string().optional(),
  messageForksHash: z.record(z.string(), MessageForkSchema).optional(),
  compactionPoints: z.array(CompactionPointSchema).optional(),
})

export const SessionMetaSchema = SessionSchema.pick({
  id: true,
  name: true,
  starred: true,
  hidden: true,
  archivedAt: true,
  assistantAvatarKey: true,
  picUrl: true,
  backgroundImage: true,
  type: true,
})

export const SessionMetaRecordSchema = SessionMetaSchema.extend({
  sortOrder: z.number(),
  createdAt: z.number(),
})

export const SessionMetaPageSchema = z.object({
  items: z.array(SessionMetaRecordSchema),
  nextCursor: z.number().nullable(),
  total: z.number(),
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
export type MessageAgentModeSuggestionPart = z.infer<typeof MessageAgentModeSuggestionPartSchema>
export type MessageReasoningPart = z.infer<typeof MessageReasoningPartSchema>
export type ImageGenerationApprovalDetails = z.infer<typeof ImageGenerationApprovalDetailsSchema>
export type AppActionApprovalDetails = z.infer<typeof AppActionApprovalDetailsSchema>
export type FileMutationApprovalStats = z.infer<typeof FileMutationApprovalStatsSchema>
export type MessageToolCallPart<Args = unknown, Result = unknown> = Omit<
  z.infer<typeof MessageToolCallPartSchema>,
  'args' | 'result'
> & {
  args?: Args
  result?: Result
  resultStorageKey?: string
  resultImageStorageKey?: string
  resultImageMediaType?: string
}
export type MessageContentParts = z.infer<typeof MessageContentPartsSchema>
/** The tool-call member of the content-part union, as stored inside MessageContentParts. */
export type MessageContentToolCallPart = Extract<MessageContentParts[number], { type: 'tool-call' }>
export type StreamTextResult = z.infer<typeof StreamTextResultSchema>
export type ToolUseScope = z.infer<typeof ToolUseScopeSchema>
export type ModelProvider = z.infer<typeof ModelProviderSchema>
export type MessageStatus = z.infer<typeof MessageStatusSchema>
export type MessageBackgroundTask = z.infer<typeof MessageBackgroundTaskSchema>
export type Message = z.infer<typeof MessageSchema>
export type SessionType = z.infer<typeof SessionTypeSchema>
export type CompactionPoint = z.infer<typeof CompactionPointSchema>
export type Session = z.infer<typeof SessionSchema>
export type SessionMeta = z.infer<typeof SessionMetaSchema>
export type SessionMetaRecord = z.infer<typeof SessionMetaRecordSchema>
export type SessionMetaPage = z.infer<typeof SessionMetaPageSchema>
export type SessionThread = z.infer<typeof SessionThreadSchema>
export type SessionThreadBrief = z.infer<typeof SessionThreadBriefSchema>
