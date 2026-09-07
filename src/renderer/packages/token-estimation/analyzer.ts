/**
 * Token Requirement Analyzer
 *
 * Analyzes messages to determine which tokens need calculation and which are cached.
 * Returns known token counts and a list of pending computation tasks.
 */

import { estimateMessageToolCallTokens } from '@shared/context/tool-tokens'
import type { Message, MessageFile, MessageLink } from '@shared/types/session'
import { MAX_INLINE_FILE_LINES } from '@/packages/context-management/attachment-payload'
import { getTokenCacheKey, isAttachmentCacheValid, isMessageTextCacheValid } from './cache-keys'
import { getPriority } from './computation-queue'
import {
  estimateDraftTokensImmediately,
  getDraftTokenizationText,
  getTokenizationTextDigest,
} from './draft-tokenization'
import { canRetryExactTokenization, getExactTokenizationFallbackCount } from './exact-retry'
import type { ComputationTask, ContentMode, TokenBreakdown, TokenizerType } from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for analyzing token requirements
 */
export interface AnalyzeTokenRequirementsOptions {
  /** Current input message (not yet sent) */
  constructedMessage: Message | undefined
  /** Context messages (already in conversation) */
  contextMessages: Message[]
  /** Tokenizer type to use */
  tokenizerType: TokenizerType
  /** Whether the model supports tool use for files (affects preview mode) */
  modelSupportToolUseForFile: boolean
  /** Whether sandbox mode is active (files sent as metadata only) */
  sandboxMode?: boolean
  /**
   * Latest draft text token count from the caller (exact worker result or
   * sampled estimate). Without it, long drafts fall back to a sampled
   * estimate that is reported as settled.
   */
  currentInputTextTokens?: number
}

/**
 * Result of token requirement analysis
 */
export interface AnalysisResult {
  /** Token count for current input (known values only) */
  currentInputTokens: number
  /** Token count for context messages (known values only) */
  contextTokens: number
  /** Tasks that need computation (without sessionId - caller must add it) */
  pendingTasks: Omit<ComputationTask, 'id' | 'createdAt' | 'sessionId'>[]
  /** Detailed breakdown of token sources */
  breakdown: {
    currentInput: TokenBreakdown
    context: TokenBreakdown
  }
}

/**
 * Result of analyzing one side (current input or context) independently
 */
export interface PartialAnalysisResult {
  /** Known token counts for this side */
  breakdown: TokenBreakdown
  /** Tasks that need computation (without sessionId - caller must add it) */
  pendingTasks: Omit<ComputationTask, 'id' | 'createdAt' | 'sessionId'>[]
  /** Whether any counted text token is a persisted sampling fallback rather than an exact encode */
  hasApproximateText: boolean
}

/**
 * Result of analyzing a single message's text
 */
interface MessageTextAnalysisResult {
  /** Known token count (0 if needs calculation) */
  tokens: number
  /** Whether calculation is needed */
  needsCalculation: boolean
  /** The counted value is a persisted sampling fallback, not an exact encode */
  approximate?: boolean
  /** Task to submit (if calculation needed) */
  task?: Omit<ComputationTask, 'id' | 'createdAt' | 'sessionId'>
}

/**
 * Result of analyzing a message's attachments
 */
interface MessageAttachmentsAnalysisResult {
  /** Known token count (sum of cached values) */
  tokens: number
  /** Tasks to submit for uncached attachments */
  tasks: Omit<ComputationTask, 'id' | 'createdAt' | 'sessionId'>[]
}

// ============================================================================
// Main Analysis Function
// ============================================================================

/**
 * Analyze token requirements for messages
 *
 * For each message (current input + context):
 * 1. Check if text token is cached and valid
 * 2. For each attachment, determine contentMode and check cache
 * 3. Return known token counts + list of tasks that need computation
 *
 * @param options - Analysis options
 * @returns Analysis result with known tokens and pending tasks
 */
export function analyzeTokenRequirements(options: AnalyzeTokenRequirementsOptions): AnalysisResult {
  const {
    constructedMessage,
    contextMessages,
    tokenizerType,
    modelSupportToolUseForFile,
    sandboxMode = false,
    currentInputTextTokens,
  } = options

  const currentInput = analyzeCurrentInputTokens({
    constructedMessage,
    tokenizerType,
    modelSupportToolUseForFile,
    sandboxMode,
    currentInputTextTokens,
  })
  const context = analyzeContextTokens({
    contextMessages,
    tokenizerType,
    modelSupportToolUseForFile,
    sandboxMode,
  })

  return {
    currentInputTokens:
      currentInput.breakdown.text + currentInput.breakdown.attachments + currentInput.breakdown.toolCalls,
    contextTokens: context.breakdown.text + context.breakdown.attachments + context.breakdown.toolCalls,
    pendingTasks: [...currentInput.pendingTasks, ...context.pendingTasks],
    breakdown: {
      currentInput: currentInput.breakdown,
      context: context.breakdown,
    },
  }
}

/**
 * Analyze only the current input message (draft). Kept separate from context
 * analysis so callers can memoize the two independently. The hook supplies
 * the latest immediate or worker-computed count without coupling draft work
 * to context message changes.
 */
export function analyzeCurrentInputTokens(options: {
  constructedMessage: Message | undefined
  tokenizerType: TokenizerType
  modelSupportToolUseForFile: boolean
  sandboxMode?: boolean
  currentInputTextTokens?: number
}): PartialAnalysisResult {
  const {
    constructedMessage,
    tokenizerType,
    modelSupportToolUseForFile,
    sandboxMode = false,
    currentInputTextTokens,
  } = options

  const pendingTasks: Omit<ComputationTask, 'id' | 'createdAt' | 'sessionId'>[] = []
  let text = 0
  let attachments = 0
  let toolCalls = 0

  if (constructedMessage) {
    const textResult = analyzeMessageText(constructedMessage, tokenizerType, true, 0, currentInputTextTokens)
    text = textResult.tokens
    if (textResult.needsCalculation && textResult.task) {
      pendingTasks.push(textResult.task)
    }

    const attachmentsResult = analyzeMessageAttachments(
      constructedMessage,
      tokenizerType,
      modelSupportToolUseForFile,
      true,
      0,
      sandboxMode
    )
    attachments = attachmentsResult.tokens
    pendingTasks.push(...attachmentsResult.tasks)

    toolCalls = estimateMessageToolCallTokens(constructedMessage)
  }

  // Draft approximation is tracked by the caller's own draft state, not the
  // persisted marker, which only ever describes stored context messages.
  return { breakdown: { text, attachments, toolCalls }, pendingTasks, hasApproximateText: false }
}

/**
 * Analyze only the context messages (already in conversation).
 */
export function analyzeContextTokens(options: {
  contextMessages: Message[]
  tokenizerType: TokenizerType
  modelSupportToolUseForFile: boolean
  sandboxMode?: boolean
}): PartialAnalysisResult {
  const { contextMessages, tokenizerType, modelSupportToolUseForFile, sandboxMode = false } = options

  const pendingTasks: Omit<ComputationTask, 'id' | 'createdAt' | 'sessionId'>[] = []
  let text = 0
  let attachments = 0
  let toolCalls = 0
  let hasApproximateText = false

  // Analyze context messages (reverse order so newest messages have higher priority)
  // contextMessages is ordered oldest to newest, but we want newest first for calculation
  const contextLength = contextMessages.length
  for (let index = 0; index < contextLength; index++) {
    const msg = contextMessages[index]
    // Reverse priority: newest message (last in array) gets priority 0
    const priorityIndex = contextLength - 1 - index

    const textResult = analyzeMessageText(msg, tokenizerType, false, priorityIndex)
    text += textResult.tokens
    if (textResult.approximate) {
      hasApproximateText = true
    }
    if (textResult.needsCalculation && textResult.task) {
      pendingTasks.push(textResult.task)
    }

    const attachmentsResult = analyzeMessageAttachments(
      msg,
      tokenizerType,
      modelSupportToolUseForFile,
      false,
      priorityIndex,
      sandboxMode
    )
    attachments += attachmentsResult.tokens
    pendingTasks.push(...attachmentsResult.tasks)

    // Tool-call weight is computed synchronously (memoized chars/4): the async
    // text-token cache never covers tool parts, which dominate agent sessions.
    toolCalls += estimateMessageToolCallTokens(msg)
  }

  return { breakdown: { text, attachments, toolCalls }, pendingTasks, hasApproximateText }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Analyze a message's text content for token calculation
 *
 * @param message - The message to analyze
 * @param tokenizerType - Tokenizer type to use
 * @param isCurrentInput - Whether this is the current input (not yet sent)
 * @param messageIndex - Position in context (0 = most recent)
 * @returns Analysis result with tokens and optional task
 */
function analyzeMessageText(
  message: Message,
  tokenizerType: TokenizerType,
  isCurrentInput: boolean,
  messageIndex: number,
  currentInputTextTokens?: number
): MessageTextAnalysisResult {
  if (isCurrentInput) {
    const tokens =
      currentInputTextTokens ?? estimateDraftTokensImmediately(getDraftTokenizationText(message), tokenizerType)
    return { tokens, needsCalculation: false }
  }

  // For context messages, check cache first
  const cachedValue = message.tokenCountMap?.[tokenizerType]
  const calculatedAt = message.tokenCalculatedAt?.[tokenizerType]
  const cacheValid = isMessageTextCacheValid(cachedValue, calculatedAt, message.updatedAt)

  if (cacheValid) {
    if (message.tokenCountApproximate?.[tokenizerType] !== true) {
      return { tokens: cachedValue ?? 0, needsCalculation: false }
    }
    // A persisted worker-failure fallback: count it as the best available
    // value but keep it marked approximate. An exact encode is re-attempted
    // only while the bounded per-run budget lasts (the next launch retries
    // afresh), so a broken worker runtime cannot loop the queue forever.
    const textDigest = getTokenizationTextDigest(getDraftTokenizationText(message))
    if (!canRetryExactTokenization(message.id, tokenizerType, textDigest)) {
      return { tokens: cachedValue ?? 0, needsCalculation: false, approximate: true }
    }
    return {
      tokens: cachedValue ?? 0,
      needsCalculation: true,
      approximate: true,
      task: {
        type: 'message-text',
        messageId: message.id,
        tokenizerType,
        textDigest,
        retryAttempt: getExactTokenizationFallbackCount(message.id, tokenizerType, textDigest),
        priority: getPriority(isCurrentInput, 'message-text', messageIndex),
      },
    }
  }

  const textDigest = getTokenizationTextDigest(getDraftTokenizationText(message))
  return {
    tokens: 0,
    needsCalculation: true,
    task: {
      type: 'message-text',
      messageId: message.id,
      tokenizerType,
      textDigest,
      retryAttempt: getExactTokenizationFallbackCount(message.id, tokenizerType, textDigest),
      priority: getPriority(isCurrentInput, 'message-text', messageIndex),
    },
  }
}

/**
 * Analyze a message's attachments for token calculation
 *
 * @param message - The message to analyze
 * @param tokenizerType - Tokenizer type to use
 * @param modelSupportToolUseForFile - Whether model supports tool use for files
 * @param isCurrentInput - Whether this is the current input (not yet sent)
 * @param messageIndex - Position in context (0 = most recent)
 * @returns Analysis result with tokens and tasks
 */
import { SANDBOX_METADATA_BASE_TOKENS, SANDBOX_METADATA_PER_ITEM_TOKENS } from '@/packages/token'

function analyzeMessageAttachments(
  message: Message,
  tokenizerType: TokenizerType,
  modelSupportToolUseForFile: boolean,
  isCurrentInput: boolean,
  messageIndex: number,
  sandboxMode: boolean
): MessageAttachmentsAnalysisResult {
  let totalTokens = 0
  const tasks: Omit<ComputationTask, 'id' | 'createdAt' | 'sessionId'>[] = []

  // Combine files and links into a single array for processing
  const allAttachments: Array<{ attachment: MessageFile | MessageLink; type: 'file' | 'link' }> = [
    ...(message.files || []).map((f) => ({ attachment: f, type: 'file' as const })),
    ...(message.links || []).map((l) => ({ attachment: l, type: 'link' as const })),
  ]

  if (allAttachments.length === 0) {
    return { tokens: 0, tasks: [] }
  }

  // In sandbox mode, only metadata XML is sent — use fixed estimate, no computation tasks needed
  if (sandboxMode) {
    const metadataTokens = SANDBOX_METADATA_BASE_TOKENS + allAttachments.length * SANDBOX_METADATA_PER_ITEM_TOKENS
    return { tokens: metadataTokens, tasks: [] }
  }

  for (const { attachment, type } of allAttachments) {
    // Skip attachments without storage key (not yet uploaded/processed)
    if (!attachment.storageKey) continue

    // Determine content mode based on file size and model capability
    const isLargeFile = (attachment.lineCount ?? 0) > MAX_INLINE_FILE_LINES
    const usePreview = modelSupportToolUseForFile && isLargeFile
    const contentMode: ContentMode = usePreview ? 'preview' : 'full'
    const cacheKey = getTokenCacheKey({ tokenizerType, contentMode })

    if (isAttachmentCacheValid(attachment, cacheKey)) {
      totalTokens += attachment.tokenCountMap?.[cacheKey] ?? 0
    } else {
      // Needs calculation
      tasks.push({
        type: 'attachment',
        messageId: message.id,
        attachmentId: attachment.id,
        attachmentType: type,
        tokenizerType,
        contentMode,
        priority: getPriority(isCurrentInput, 'attachment', messageIndex),
      })
    }
  }

  return { tokens: totalTokens, tasks }
}
