import {
  type AttachmentAnalysis,
  type AttachmentPreparationOptions,
  AttachmentService,
  type ParsedAttachmentContent,
  type PickedAsset,
} from '@chatbox/core/application/attachments'
import { projectSessionMeta } from '@chatbox/core/application/session'
import { isSessionAttachmentRagSupportedFilePath, isSupportedFile, isTextFilePath } from '@shared/file-extensions'
import {
  CHATBOX_AI_PARSER_LICENSE_KEY_REQUIRED_ERROR,
  EMPTY_ATTACHMENT_CONTENT_ERROR,
  NON_RECOVERABLE_LOCAL_PARSER_ERROR_CODES,
} from '@shared/file-parse-errors'
import { searchSessionMessages } from '@shared/services/native-session-search'
import type { Session, SessionMeta, SessionSettings, SessionThreadBrief, Settings } from '@shared/types'
import type { DocumentParserConfig } from '@shared/types/settings'
import { migrateMessage } from '@shared/utils/message'
import { BrowserAttachmentAdapter } from '@/adapters/BrowserAttachmentAdapter'
import { CapacitorAttachmentAdapter } from '@/adapters/CapacitorAttachmentAdapter'
import { DesktopAttachmentAdapter } from '@/adapters/DesktopAttachmentAdapter'
import { getLogger } from '@/lib/utils'
import { PREVIEW_LINES } from '@/packages/context-management/attachment-payload'
import * as localParser from '@/packages/local-parser'
import * as remote from '@/packages/remote'
import { estimateTokens } from '@/packages/token'
import platform from '@/platform'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { authInfoStore } from '@/stores/authInfoStore'
import { rendererApplication } from '@/app/renderer-application'
import { reportError } from '@/utils/sentry'
import { migrateSession } from '@/utils/session-utils'
import * as defaults from '../../shared/defaults'
import { SESSION_ATTACHMENT_RAG_LOG_PREFIX } from '../../shared/session-attachment-rag/logging'
import { createMessage, type Message, SessionSettingsSchema, TOKEN_CACHE_KEYS } from '../../shared/types'
import type { AttachmentPreparationResult, PreprocessedFile } from '../types/input-box'
import { resolveChatboxLicenseDefaultModel } from './defaultChatModel'
import { lastUsedModelStore } from './lastUsedModelStore'
import { SESSION_ATTACHMENT_RAG_LARGE_ATTACHMENT_WARNING } from './sessionAttachmentRagErrors'
import * as settingActions from './settingActions'
import { getPlatformDefaultDocumentParser, settingsStore } from './settingsStore'

export {
  isSessionAttachmentRagAuthError,
  isSessionAttachmentRagIndexingError,
  SESSION_ATTACHMENT_RAG_LARGE_ATTACHMENT_WARNING,
  SESSION_ATTACHMENT_RAG_PARSED_CONTENT_TOO_LARGE_ERROR,
  SESSION_ATTACHMENT_RAG_REQUIRES_CHATBOX_AI_ERROR,
  SESSION_ATTACHMENT_RAG_REQUIRES_KNOWLEDGE_BASE_ERROR,
  SESSION_ATTACHMENT_RAG_REQUIRES_TOOL_USE_MODEL_ERROR,
} from './sessionAttachmentRagErrors'

/** Session meta repository access for maintenance/setup flows (initializes the service first). */
export async function getMetaStorage() {
  await rendererApplication.sessions.initialize()
  return rendererApplication.sessions.repository.meta
}

const log = getLogger('session-helpers')
const FILE_STORAGE_QUOTA_EXCEEDED_ERROR = 'file_storage_quota_exceeded'
const FILE_PREPROCESS_FAILED_ERROR = 'file_preprocess_failed'
const SESSION_ATTACHMENT_RAG_INLINE_BYTE_THRESHOLD = 256 * 1024
export const SESSION_ATTACHMENT_RAG_MAX_PARSED_BYTE_LENGTH = 6 * 1024 * 1024
let sessionRagCapabilityCache:
  | {
      key: string
      value: boolean
    }
  | undefined

type ContentStats = {
  lineCount: number
  byteLength: number
  previewContent: string
}

type FilePreprocessStage =
  | 'cache_read'
  | 'cloud_parse'
  | 'content_analysis'
  | 'local_parse'
  | 'metadata_storage'
  | 'parse'
  | 'token_estimation'

class FilePreprocessFailure extends Error {
  constructor(
    readonly code: string,
    readonly stage: FilePreprocessStage,
    readonly originalError: unknown
  ) {
    super(code)
    this.name = 'FilePreprocessFailure'
  }
}

const EXPECTED_FILE_PREPROCESS_ERROR_CODES = new Set([
  'chatbox_ai_parser_failed',
  CHATBOX_AI_PARSER_LICENSE_KEY_REQUIRED_ERROR,
  'document_parser_not_configured',
  EMPTY_ATTACHMENT_CONTENT_ERROR,
  'license_key_required',
  'local_parser_failed',
  'mineru_api_token_required',
  'parsing_cancelled',
  'third_party_parser_failed',
  'third_party_parser_not_supported_in_chat',
  ...NON_RECOVERABLE_LOCAL_PARSER_ERROR_CODES,
])

function isStorageQuotaError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  return (
    name === 'QuotaExceededError' ||
    /quota.{0,20}exceed|storage.{0,20}full|database or disk is full|not enough.{0,20}(?:space|storage)|no space left|ENOSPC/i.test(
      message
    )
  )
}

function getSafeFileExtension(fileName: string): string {
  const match = fileName.match(/\.([a-z0-9]{1,12})$/i)
  return match?.[1].toLowerCase() ?? 'none'
}

function getFileSizeBucket(size: number): string {
  if (size < 100 * 1024) return 'under_100_kb'
  if (size < 1024 * 1024) return '100_kb_to_1_mb'
  if (size < 10 * 1024 * 1024) return '1_mb_to_10_mb'
  if (size < 50 * 1024 * 1024) return '10_mb_to_50_mb'
  return 'over_50_mb'
}

function getSafeErrorType(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error
  return /^[a-z][a-z0-9]{0,39}$/i.test(name) ? name : 'unknown'
}

function createSafeReportedError(error: unknown, errorCode: string): Error {
  const reportedError = new Error(errorCode)
  if (error instanceof Error && error.stack) {
    const stackFrames = error.stack.split('\n').filter((line) => /^\s+at\s/.test(line))
    if (stackFrames.length > 0) {
      reportedError.stack = [`Error: ${errorCode}`, ...stackFrames].join('\n')
    }
  }
  return reportedError
}

function getStorageEstimateBucket(bytes: number | undefined): string {
  if (bytes === undefined) return 'unknown'
  if (bytes < 100 * 1024 * 1024) return 'under_100_mb'
  if (bytes < 1024 * 1024 * 1024) return '100_mb_to_1_gb'
  if (bytes < 10 * 1024 * 1024 * 1024) return '1_gb_to_10_gb'
  return 'over_10_gb'
}

async function getStorageEstimateTags(): Promise<Record<string, string>> {
  try {
    const estimate = await navigator.storage?.estimate?.()
    if (!estimate) return {}
    const quota = estimate.quota ?? 0
    const usage = estimate.usage ?? 0
    return {
      storage_quota_bucket: getStorageEstimateBucket(estimate.quota),
      storage_usage_bucket: getStorageEstimateBucket(estimate.usage),
      storage_usage_ratio: quota > 0 ? String(Math.min(100, Math.round((usage / quota) * 100))) : 'unknown',
    }
  } catch {
    return {}
  }
}

async function reportFilePreprocessFailure(
  file: File,
  failure: FilePreprocessFailure,
  extraTags?: Record<string, string | number>
): Promise<void> {
  const storageTags = failure.code === FILE_STORAGE_QUOTA_EXCEEDED_ERROR ? await getStorageEstimateTags() : {}
  reportError(createSafeReportedError(failure.originalError, failure.code), {
    domain: 'file-attachment',
    operation: 'preprocess-file',
    priority: 'high',
    tags: {
      error_type: getSafeErrorType(failure.originalError),
      file_extension: getSafeFileExtension(file.name),
      file_size_bucket: getFileSizeBucket(file.size),
      platform_type: platform.type,
      preprocess_stage: failure.stage,
      user_error_code: failure.code,
      ...storageTags,
      ...extraTags,
    },
  })
}

function normalizeFilePreprocessFailure(error: unknown, stage: FilePreprocessStage): FilePreprocessFailure | undefined {
  if (error instanceof FilePreprocessFailure) return error
  if (isStorageQuotaError(error)) {
    return new FilePreprocessFailure(FILE_STORAGE_QUOTA_EXCEEDED_ERROR, stage, error)
  }

  const errorCode = error instanceof Error ? error.message : ''
  if (EXPECTED_FILE_PREPROCESS_ERROR_CODES.has(errorCode)) return undefined
  return new FilePreprocessFailure(FILE_PREPROCESS_FAILED_ERROR, stage, error)
}

function getContentStats(content: string): ContentStats {
  const lines = content.split('\n')
  return {
    lineCount: lines.length,
    byteLength: new TextEncoder().encode(content).length,
    previewContent: lines.slice(0, PREVIEW_LINES).join('\n'),
  }
}

function isParsedContentVeryLarge(stats: ContentStats): boolean {
  return stats.byteLength > SESSION_ATTACHMENT_RAG_MAX_PARSED_BYTE_LENGTH
}

export function computePreviewMetadata(
  content: string,
  existingTokenMap: Record<string, number> = {},
  options: {
    includeFullTokenCounts?: boolean
    stats?: ContentStats
  } = {}
): {
  lineCount: number
  byteLength: number
  tokenCountMap: Record<string, number>
  tokenCalculatedAt: Record<string, number>
} {
  const { includeFullTokenCounts = true, stats = getContentStats(content) } = options
  const { lineCount, byteLength, previewContent } = stats
  const now = Date.now()

  const tokenCountMap: Record<string, number> = { ...existingTokenMap }
  const tokenCalculatedAt: Record<string, number> = {}

  if (includeFullTokenCounts && tokenCountMap[TOKEN_CACHE_KEYS.default] === undefined) {
    tokenCountMap[TOKEN_CACHE_KEYS.default] = estimateTokens(content)
    tokenCalculatedAt[TOKEN_CACHE_KEYS.default] = now
  }

  if (includeFullTokenCounts && tokenCountMap[TOKEN_CACHE_KEYS.deepseek] === undefined) {
    tokenCountMap[TOKEN_CACHE_KEYS.deepseek] = estimateTokens(content, { provider: '', modelId: 'deepseek' })
    tokenCalculatedAt[TOKEN_CACHE_KEYS.deepseek] = now
  }

  tokenCountMap.default_preview = estimateTokens(previewContent)
  tokenCalculatedAt.default_preview = now

  tokenCountMap.deepseek_preview = estimateTokens(previewContent, { provider: '', modelId: 'deepseek' })
  tokenCalculatedAt.deepseek_preview = now

  return { lineCount, byteLength, tokenCountMap, tokenCalculatedAt }
}

function getEffectiveDocumentParserConfig(): DocumentParserConfig {
  const globalConfig = settingsStore.getState().extension?.documentParser
  return globalConfig ?? getPlatformDefaultDocumentParser()
}

function hasParsedText(content: string): boolean {
  return content.trim().length > 0
}

type LocalParserFallbackOptions = {
  allowChatboxAIFallback?: boolean
  forceChatboxAIFallback?: boolean
}

function canFallbackToChatboxAI(): boolean {
  return Boolean(settingActions.getLicenseKey())
}

function isChatboxAIFallbackAllowed(options: LocalParserFallbackOptions): boolean {
  return Boolean(options.forceChatboxAIFallback) || options.allowChatboxAIFallback !== false
}

function requireChatboxAIParserLicense(): never {
  throw new Error(CHATBOX_AI_PARSER_LICENSE_KEY_REQUIRED_ERROR)
}

function hasUsableSessionAttachmentRagLicense(): boolean {
  const settings = settingsStore.getState()
  if (!settings.licenseKey) {
    return false
  }
  if (settings.licenseActivationMethod === 'login') {
    return !!authInfoStore.getState().getTokens()
  }
  return true
}

function hasDefaultSessionAttachmentEmbeddingModel(): boolean {
  const defaultEmbeddingModel = settingsStore.getState().defaultEmbeddingModel
  return Boolean(defaultEmbeddingModel?.provider && defaultEmbeddingModel.model)
}

function getDefaultSessionAttachmentEmbeddingModelLabel(): string {
  const defaultEmbeddingModel = settingsStore.getState().defaultEmbeddingModel
  return defaultEmbeddingModel?.provider && defaultEmbeddingModel.model
    ? `${defaultEmbeddingModel.provider}:${defaultEmbeddingModel.model}`
    : 'none'
}

async function canUseSessionAttachmentRag(): Promise<boolean> {
  const licenseKey = settingActions.getLicenseKey() || ''
  const hasUsableLicense = hasUsableSessionAttachmentRagLicense()
  const hasDefaultEmbeddingModel = hasDefaultSessionAttachmentEmbeddingModel()
  const capabilityCacheKey = `${licenseKey}:${hasUsableLicense ? 'active' : 'inactive'}:${
    hasDefaultEmbeddingModel ? 'default-embedding' : 'no-default-embedding'
  }`
  if (sessionRagCapabilityCache?.key === capabilityCacheKey) {
    log.debug(
      `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} Capability cache hit: embedding=${sessionRagCapabilityCache.value}, hasLicense=${Boolean(licenseKey)}`
    )
    return sessionRagCapabilityCache.value
  }

  if (hasDefaultEmbeddingModel) {
    log.debug(
      `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} Capability enabled by default embedding model, hasLicense=${Boolean(licenseKey)}, platform=${platform.type}, embeddingModel=${getDefaultSessionAttachmentEmbeddingModelLabel()}`
    )
    sessionRagCapabilityCache = { key: capabilityCacheKey, value: true }
    return true
  }

  if (!hasUsableLicense) {
    log.debug(
      `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} Capability skipped: missing active Chatbox license, hasLicense=${Boolean(licenseKey)}, method=${settingsStore.getState().licenseActivationMethod ?? 'none'}, platform=${platform.type}`
    )
    sessionRagCapabilityCache = { key: capabilityCacheKey, value: false }
    return false
  }

  const value = !!(await remote.getSessionRagConfig({ licenseKey: licenseKey || undefined }).catch(() => undefined))
    ?.capabilities?.session_attachment_embedding
  log.debug(
    `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} Capability fetched: embedding=${value}, hasLicense=${Boolean(licenseKey)}, platform=${platform.type}`
  )
  sessionRagCapabilityCache = { key: capabilityCacheKey, value }
  return value
}

/**
 * Parse file using local parser
 */
async function parseFileWithLocalParser(file: File): Promise<ParsedAttachmentContent> {
  const result = await platform.parseFileLocally(file)

  if (!result.isSupported || !result.key) {
    // Preserve a specific parser error code (password-protected / too large) so the
    // UI can explain it; otherwise fall back to the generic failure.
    throw new Error(result.errorCode || 'local_parser_failed')
  }

  // Get content from temporary storage
  const content = (await storage.getBlob(result.key).catch(() => '')) || ''

  try {
    return { content, tokenCountMap: {}, parserType: 'local' }
  } finally {
    await storage.delBlob(result.key).catch(() => undefined)
  }
}

async function fallbackToChatboxAIParser(
  file: File,
  reason: 'local_parser_failed' | 'empty_content'
): Promise<ParsedAttachmentContent> {
  log.warn(`Falling back to Chatbox AI parser for "${file.name}" due to ${reason}`)

  try {
    return await parseFileWithChatboxAI(file)
  } catch (error) {
    log.error(`Chatbox AI fallback parsing failed for "${file.name}":`, error)
    if (isStorageQuotaError(error)) {
      throw new FilePreprocessFailure(FILE_STORAGE_QUOTA_EXCEEDED_ERROR, 'cloud_parse', error)
    }
    if (
      error instanceof Error &&
      (error.message === EMPTY_ATTACHMENT_CONTENT_ERROR ||
        error.message === CHATBOX_AI_PARSER_LICENSE_KEY_REQUIRED_ERROR ||
        error.message === 'license_key_required')
    ) {
      throw error
    }
    throw new Error('chatbox_ai_parser_failed')
  }
}

function shouldFallbackToChatboxAI(options: LocalParserFallbackOptions): boolean {
  return isChatboxAIFallbackAllowed(options) && canFallbackToChatboxAI()
}

async function parseFileWithLocalFallback(
  file: File,
  options: LocalParserFallbackOptions = {}
): Promise<ParsedAttachmentContent> {
  try {
    const result = await parseFileWithLocalParser(file)
    if (!hasParsedText(result.content)) {
      if (shouldFallbackToChatboxAI(options)) {
        return await fallbackToChatboxAIParser(file, 'empty_content')
      }
      if (isChatboxAIFallbackAllowed(options)) {
        requireChatboxAIParserLicense()
      }
      throw new FilePreprocessFailure(
        EMPTY_ATTACHMENT_CONTENT_ERROR,
        'local_parse',
        new Error('Local parser returned empty content')
      )
    }
    return result
  } catch (error) {
    log.error(`Local parsing failed for "${file.name}":`, error)

    if (error instanceof FilePreprocessFailure) {
      throw error
    }

    if (error instanceof Error && error.message === CHATBOX_AI_PARSER_LICENSE_KEY_REQUIRED_ERROR) {
      throw error
    }

    // Encrypted or oversized PDFs cannot be recovered by the cloud parser either,
    // so surface the specific error directly instead of wasting a fallback upload.
    const errorCode = error instanceof Error ? error.message : ''
    if (NON_RECOVERABLE_LOCAL_PARSER_ERROR_CODES.has(errorCode)) {
      throw error
    }

    if (isStorageQuotaError(error)) {
      throw new FilePreprocessFailure(FILE_STORAGE_QUOTA_EXCEEDED_ERROR, 'local_parse', error)
    }

    if (shouldFallbackToChatboxAI(options)) {
      return await fallbackToChatboxAIParser(file, 'local_parser_failed')
    }

    if (isChatboxAIFallbackAllowed(options)) {
      requireChatboxAIParserLicense()
    }

    if (errorCode === 'local_parser_failed') {
      throw error
    }
    throw new FilePreprocessFailure('local_parser_failed', 'local_parse', error)
  }
}

/**
 * Parse file using Chatbox AI cloud service
 */
async function parseFileWithChatboxAI(file: File): Promise<ParsedAttachmentContent> {
  const licenseKey = settingActions.getLicenseKey()
  if (!licenseKey) {
    requireChatboxAIParserLicense()
  }
  const uploadedKey = await remote.uploadAndCreateUserFile(licenseKey, file)

  // Get uploaded file content
  const content = (await storage.getBlob(uploadedKey).catch(() => '')) || ''

  try {
    if (!hasParsedText(content)) {
      throw new Error(EMPTY_ATTACHMENT_CONTENT_ERROR)
    }
    return { content, tokenCountMap: {}, parserType: 'chatbox-ai' }
  } finally {
    await storage.delBlob(uploadedKey).catch(() => undefined)
  }
}

/**
 * Parse file using MinerU service (Desktop only)
 */
async function parseFileWithMineruService(file: File, apiToken: string): Promise<ParsedAttachmentContent> {
  // Check if platform supports MinerU parsing
  if (!platform.parseFileWithMineru) {
    throw new Error('third_party_parser_not_supported_in_chat')
  }

  // Call platform method to parse file
  const result = await platform.parseFileWithMineru(file, apiToken)

  // Handle cancellation - throw a special error that will be caught silently
  if (result.cancelled) {
    throw new Error('parsing_cancelled')
  }

  if (!result.success || !result.content || !hasParsedText(result.content)) {
    throw new Error(EMPTY_ATTACHMENT_CONTENT_ERROR)
  }

  return { content: result.content, tokenCountMap: {}, parserType: 'mineru' }
}

function createPickedAssetAdapter(): BrowserAttachmentAdapter {
  if (platform.type === 'mobile') {
    return new CapacitorAttachmentAdapter()
  }
  if (platform.isDesktopLike && typeof platform.getLocalFilePath === 'function') {
    return new DesktopAttachmentAdapter((file) => platform.getLocalFilePath(file))
  }
  return new BrowserAttachmentAdapter()
}

const pickedAssetAdapter = createPickedAssetAdapter()

async function parsePickedAsset(
  asset: PickedAsset,
  options: AttachmentPreparationOptions
): Promise<ParsedAttachmentContent> {
  const file = pickedAssetAdapter.getFile(asset)
  const isTextFile = isTextFilePath(asset.name)

  // In agent mode, skip content parsing when no parser can produce text. The
  // shared service has already stored the raw bytes for sandbox execution.
  if (
    options.agentMode &&
    !isTextFile &&
    (!isSupportedFile(asset.name) || getEffectiveDocumentParserConfig().type === 'none')
  ) {
    log.debug(`Agent mode: skipping content parsing for sandbox-only file: ${asset.name}`)
    return {
      content: `[File: ${asset.name} (${(asset.size / 1024).toFixed(1)} KB)]`,
      tokenCountMap: {},
      parserType: 'sandbox-raw',
      skipAnalysisAndMetadata: true,
    }
  }

  if (isTextFile) {
    log.debug(`Text file detected, using local parser: ${asset.name}`)
    return parseFileWithLocalFallback(file, {
      allowChatboxAIFallback: options.source !== 'pasted-text',
    })
  }

  const parserConfig = getEffectiveDocumentParserConfig()
  log.debug(`Using document parser: ${parserConfig.type} for file: ${asset.name}`)
  switch (parserConfig.type) {
    case 'none':
      throw new Error('document_parser_not_configured')
    case 'local':
      return parseFileWithLocalFallback(file)
    case 'chatbox-ai':
      return parseFileWithLocalFallback(file, { forceChatboxAIFallback: true })
    case 'mineru': {
      const apiToken = parserConfig.mineru?.apiToken
      if (!apiToken) {
        throw new Error('mineru_api_token_required')
      }
      try {
        return await parseFileWithMineruService(file, apiToken)
      } catch (error) {
        log.error(`MinerU parsing failed for "${asset.name}":`, error)
        if (
          error instanceof Error &&
          (error.message === EMPTY_ATTACHMENT_CONTENT_ERROR || error.message.startsWith('third_party_parser'))
        ) {
          throw error
        }
        throw new Error('third_party_parser_failed')
      }
    }
    default:
      throw new Error('document_parser_not_configured')
  }
}

async function analyzePickedAsset(input: {
  asset: PickedAsset
  content: string
  parserType?: string
  existingTokenCountMap: Record<string, number>
}): Promise<AttachmentAnalysis> {
  const { asset, content, parserType, existingTokenCountMap } = input
  const stats = getContentStats(content)
  const sessionAttachmentWarningReason = isParsedContentVeryLarge(stats)
    ? SESSION_ATTACHMENT_RAG_LARGE_ATTACHMENT_WARNING
    : undefined
  if (sessionAttachmentWarningReason) {
    log.info(
      `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} Parsed content is very large: file="${asset.name}", parser=${parserType ?? 'unknown'}, bytes=${stats.byteLength}, limit=${SESSION_ATTACHMENT_RAG_MAX_PARSED_BYTE_LENGTH}`
    )
  }

  const isSessionAttachmentRagFileType = isSessionAttachmentRagSupportedFilePath(asset.name)
  const exceedsSessionAttachmentRagThreshold =
    platform.isDesktopLike &&
    isSessionAttachmentRagFileType &&
    stats.byteLength > SESSION_ATTACHMENT_RAG_INLINE_BYTE_THRESHOLD
  const sessionAttachmentRagAllowed = exceedsSessionAttachmentRagThreshold ? await canUseSessionAttachmentRag() : false
  const shouldUseSessionAttachmentRag =
    exceedsSessionAttachmentRagThreshold && sessionAttachmentRagAllowed && !sessionAttachmentWarningReason
  const { lineCount, byteLength, tokenCountMap } = computePreviewMetadata(content, existingTokenCountMap, {
    includeFullTokenCounts: !shouldUseSessionAttachmentRag,
    stats,
  })

  log.debug(
    `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} Preprocess decision: file="${asset.name}", parser=${parserType ?? 'unknown'}, bytes=${stats.byteLength}, tokens=${tokenCountMap[TOKEN_CACHE_KEYS.default] ?? 0}, ragFileType=${isSessionAttachmentRagFileType}, exceedsThreshold=${exceedsSessionAttachmentRagThreshold}, ragMode=${shouldUseSessionAttachmentRag ? 'session-retrieval' : 'inline'}, allowed=${sessionAttachmentRagAllowed}`
  )

  return {
    ragMode: shouldUseSessionAttachmentRag ? 'session-retrieval' : 'inline',
    tokenCountMap,
    lineCount,
    byteLength,
    sessionAttachmentAvailability: 'allowed',
    sessionAttachmentWarningReason,
  }
}

const attachmentService = new AttachmentService({
  blobs: {
    get: (key) => storage.getBlob(key),
    set: (key, value) => storage.setBlob(key, value),
  },
  metadata: {
    get: <T>(key: string) => storage.getItem<T | null>(key, null),
    async set(key, value) {
      try {
        await storage.setItem(key, value)
      } catch (error) {
        throw normalizeFilePreprocessFailure(error, 'metadata_storage') ?? error
      }
    },
  },
  content: pickedAssetAdapter,
  parser: { parse: parsePickedAsset },
  analysis: { analyze: analyzePickedAsset },
  logger: {
    log(level, message, context) {
      const error = context?.error
      if (level === 'error') log.error(message, error)
      else if (level === 'warn') log.warn(message, error)
      else if (level === 'info') log.info(message, error)
      else log.debug(message, error)
    },
  },
})

async function prepareFileAttachmentOnce(
  file: File,
  asset: PickedAsset,
  options?: AttachmentPreparationOptions
): Promise<AttachmentPreparationResult> {
  try {
    const { asset: _preparedAsset, ...prepared } = await attachmentService.prepareOrThrow(asset, options)
    return { file, ...prepared }
  } catch (error) {
    log.error(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} Failed to preprocess file "${file.name}":`, error)
    throw normalizeFilePreprocessFailure(error, 'parse') ?? error
  }
}

function buildFilePreprocessErrorResult(file: File, error: unknown): AttachmentPreparationResult {
  const failure = error instanceof FilePreprocessFailure ? error : undefined
  return {
    file,
    content: '',
    storageKey: '',
    error: failure?.code ?? (error instanceof Error ? error.message : FILE_PREPROCESS_FAILED_ERROR),
  }
}

async function tryFreeOrphanedBlobs(): Promise<number | undefined> {
  try {
    const { cleanupOrphanedBlobs } = await import('@/setup/storage_clear')
    return await cleanupOrphanedBlobs()
  } catch (cleanupError) {
    log.warn('Orphaned blob cleanup after a storage quota failure did not complete:', cleanupError)
    return undefined
  }
}

/**
 * Keep the Renderer File API stable while converting it to a host-neutral
 * PickedAsset before application orchestration. Storage quota exhaustion
 * triggers one orphan-cleanup and retry before returning a stable error code.
 */
export async function prepareFileAttachment(
  file: File,
  _settings: SessionSettings,
  options?: AttachmentPreparationOptions
): Promise<AttachmentPreparationResult> {
  const asset = pickedAssetAdapter.fromFile(file)
  try {
    try {
      return await prepareFileAttachmentOnce(file, asset, options)
    } catch (error) {
      const failure = error instanceof FilePreprocessFailure ? error : undefined
      if (failure?.code !== FILE_STORAGE_QUOTA_EXCEEDED_ERROR) {
        if (failure) await reportFilePreprocessFailure(file, failure)
        return buildFilePreprocessErrorResult(file, error)
      }

      const freedBlobCount = await tryFreeOrphanedBlobs()
      const cleanupTags: Record<string, string | number> =
        freedBlobCount === undefined ? { cleanup_outcome: 'cleanup_failed' } : { freed_blob_count: freedBlobCount }

      try {
        const result = await prepareFileAttachmentOnce(file, asset, options)
        await reportFilePreprocessFailure(file, failure, {
          quota_recovery: 'recovered',
          ...cleanupTags,
        })
        return result
      } catch (retryError) {
        if (retryError instanceof FilePreprocessFailure) {
          await reportFilePreprocessFailure(file, retryError, {
            quota_recovery: 'retry_failed',
            ...cleanupTags,
          })
        }
        return buildFilePreprocessErrorResult(file, retryError)
      }
    }
  } finally {
    pickedAssetAdapter.release(asset)
  }
}

/**
 * 预处理链接以获取内容
 * @param url 链接地址
 * @param settings 会话设置
 * @returns 预处理后的链接信息
 */
export async function preprocessLink(
  url: string,
  settings: SessionSettings
): Promise<{
  url: string
  title: string
  content: string
  storageKey: string
  tokenCountMap?: Record<string, number>
  lineCount?: number
  byteLength?: number
  error?: string
}> {
  try {
    const isPro = settingActions.isPro()
    const uniqKey = StorageKeyGenerator.linkUniqKey(url)

    // 检查是否已经处理过这个链接
    const existingContent = await storage.getBlob(uniqKey).catch(() => null)
    if (existingContent) {
      // 如果已经有内容，尝试从内容中提取标题
      const titleMatch = existingContent.match(/<title[^>]*>([^<]+)<\/title>/i)
      const title = titleMatch ? titleMatch[1] : url.replace(/^https?:\/\//, '')

      // Get existing token map or create new one
      const existingTokenMap: Record<string, number> = (await storage.getItem(`${uniqKey}_tokenMap`, {})) as Record<
        string,
        number
      >

      const { lineCount, byteLength, tokenCountMap } = computePreviewMetadata(existingContent, existingTokenMap)

      await storage.setItem(`${uniqKey}_tokenMap`, tokenCountMap)

      return {
        url,
        title,
        content: existingContent,
        storageKey: uniqKey,
        tokenCountMap,
        lineCount,
        byteLength,
      }
    }

    if (isPro) {
      // ChatboxAI 方案：使用远程解析
      const licenseKey = settingActions.getLicenseKey()
      const parsed = await remote.parseUserLinkPro({ licenseKey: licenseKey || '', url })

      // 获取解析后的内容
      const content = (await storage.getBlob(parsed.storageKey).catch(() => '')) || ''

      // 将内容存储到唯一键下
      if (content) {
        await storage.setBlob(uniqKey, content)
      }

      // Calculate token counts including preview metadata
      const { lineCount, byteLength, tokenCountMap } = content
        ? computePreviewMetadata(content)
        : { lineCount: undefined, byteLength: undefined, tokenCountMap: {} }

      // Store token map for future use
      if (content) {
        await storage.setItem(`${uniqKey}_tokenMap`, tokenCountMap)
      }

      return {
        url,
        title: parsed.title,
        content,
        storageKey: uniqKey,
        tokenCountMap,
        lineCount,
        byteLength,
      }
    } else {
      // 本地方案：解析链接内容
      const { key, title } = await localParser.parseUrl(url)
      const content = (await storage.getBlob(key).catch(() => '')) || ''

      // 将内容存储到唯一键下
      if (content) {
        await storage.setBlob(uniqKey, content)
      }

      const { lineCount, byteLength, tokenCountMap } = content
        ? computePreviewMetadata(content)
        : { lineCount: undefined, byteLength: undefined, tokenCountMap: {} }

      if (content) {
        await storage.setItem(`${uniqKey}_tokenMap`, tokenCountMap)
      }

      return {
        url,
        title,
        content,
        storageKey: uniqKey,
        tokenCountMap,
        lineCount,
        byteLength,
      }
    }
  } catch (error) {
    return {
      url,
      title: url.replace(/^https?:\/\//, ''),
      content: '',
      storageKey: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * 构建用户消息，只包含元数据不包含内容
 * @param text 消息文本
 * @param pictureKeys 图片存储键列表
 * @param preprocessedFiles 预处理后的文件信息
 * @param preprocessedLinks 预处理后的链接信息
 * @returns 构建好的消息对象
 */
export function constructUserMessage(
  messageId: string | undefined,
  text: string,
  pictureKeys: string[] = [],
  preprocessedFiles: PreprocessedFile[] = [],
  preprocessedLinks: Array<{
    url: string
    title: string
    content: string
    storageKey: string
    tokenCountMap?: Record<string, number>
    lineCount?: number
    byteLength?: number
  }> = []
): Message {
  // 只使用原始文本，不添加文件和链接内容
  const msg = createMessage('user', text)
  if (messageId) {
    msg.id = messageId
  }

  // 添加图片
  if (pictureKeys.length > 0) {
    msg.contentParts = msg.contentParts ?? []
    msg.contentParts.push(...pictureKeys.map((k) => ({ type: 'image' as const, storageKey: k })))
  }

  if (preprocessedFiles.length > 0) {
    msg.files = preprocessedFiles.map((f) => {
      const localPath =
        f.ragMode === 'session-retrieval'
          ? undefined
          : f.localPath || platform.getLocalFilePath(f.file) || f.file.path || undefined

      return {
        id: f.storageKey || f.file.name,
        name: f.file.name,
        fileType: f.file.type,
        parserType: f.parserType,
        storageKey: f.storageKey || undefined,
        rawStorageKey: f.rawStorageKey,
        localPath,
        ragMode: f.ragMode ?? 'inline',
        sessionAttachmentId: f.sessionAttachmentId,
        sessionAttachmentAvailability: f.sessionAttachmentAvailability ?? 'allowed',
        sessionAttachmentIndexStatus:
          f.ragMode === 'session-retrieval' ? (f.sessionAttachmentIndexStatus ?? 'pending') : undefined,
        sessionAttachmentBlockedReason: f.sessionAttachmentBlockedReason,
        sessionAttachmentWarningReason: f.sessionAttachmentWarningReason,
        sessionAttachmentChunkCount: f.sessionAttachmentChunkCount,
        sessionAttachmentTotalChunks: f.sessionAttachmentTotalChunks,
        sessionAttachmentEmbeddedChunks: f.sessionAttachmentEmbeddedChunks,
        sessionAttachmentIndexingStage: f.sessionAttachmentIndexingStage,
        tokenCountMap: f.tokenCountMap,
        lineCount: f.lineCount,
        byteLength: f.byteLength,
      }
    })
  }

  if (preprocessedLinks.length > 0) {
    msg.links = preprocessedLinks.map((l) => ({
      id: l.storageKey || l.url,
      url: l.url,
      title: l.title,
      storageKey: l.storageKey,
      tokenCountMap: l.tokenCountMap,
      lineCount: l.lineCount,
      byteLength: l.byteLength,
    }))
  }

  return msg
}

export function mergeSettings(
  globalSettings: Settings,
  sessionSetting?: SessionSettings,
  sessionType?: 'picture' | 'chat' | 'guide'
): SessionSettings {
  if (!sessionSetting) {
    return SessionSettingsSchema.parse(globalSettings)
  }
  return SessionSettingsSchema.parse({
    ...globalSettings,
    ...(sessionType === 'picture'
      ? {
          imageGenerateNum: defaults.pictureSessionSettings().imageGenerateNum,
          dalleStyle: defaults.pictureSessionSettings().dalleStyle,
        }
      : {
          maxContextMessageCount: defaults.chatSessionSettings().maxContextMessageCount,
        }),
    ...sessionSetting,
  })
}

export function initEmptyChatSession(): Omit<Session, 'id'> {
  const settings = settingsStore.getState().getSettings()
  const { chat: lastUsedChatModel } = lastUsedModelStore.getState()
  const defaultChatModel = settings.defaultChatModel
    ? {
        provider: settings.defaultChatModel.provider,
        modelId: settings.defaultChatModel.model,
      }
    : lastUsedChatModel || resolveChatboxLicenseDefaultModel(settings)
  const newSession: Omit<Session, 'id'> = {
    name: 'Untitled',
    type: 'chat',
    threadName: '',
    messages: [],
    settings: {
      maxContextMessageCount: settings.maxContextMessageCount ?? Number.MAX_SAFE_INTEGER,
      temperature: settings.temperature || undefined,
      topP: settings.topP || undefined,
      ...defaultChatModel,
    },
  }
  if (settings.defaultPrompt) {
    newSession.messages.push(createMessage('system', settings.defaultPrompt || defaults.getDefaultPrompt()))
  }
  return newSession
}

export function getSessionMeta(session: SessionMeta) {
  return projectSessionMeta(session)
}

function _searchSessions(query: string, s: Session) {
  // Shared matcher, also used by the native mobile shell.
  const session = migrateSession(s)
  return searchSessionMessages(session, query).map((m) => migrateMessage(m))
}

const SEARCH_PAGE_SIZE = 30
const SEARCH_RESULT_LIMIT = 50

export async function searchSessions(searchInput: string, sessionId?: string, onResult?: (result: Session[]) => void) {
  let matchedMessageTotal = 0

  const emitBatch = (batch: Session[]) => {
    if (batch.length === 0) {
      return
    }
    onResult?.(batch)
  }

  if (sessionId) {
    const session = await storage.getItem<Session | null>(StorageKeyGenerator.session(sessionId), null)
    if (session) {
      const matchedMessages = _searchSessions(searchInput, session)
      matchedMessageTotal += matchedMessages.length
      emitBatch([{ ...session, messages: matchedMessages }])
    }
    return
  }

  const metaStorage = await getMetaStorage()
  let cursor: number | null = 0

  while (cursor !== null) {
    const page = await metaStorage.getPage(cursor, SEARCH_PAGE_SIZE)

    // Load full sessions for this page in parallel to amortize I/O latency.
    const sessions = await Promise.all(
      page.items.map((meta) => storage.getItem<Session | null>(StorageKeyGenerator.session(meta.id), null))
    )

    const batch: Session[] = []
    for (const session of sessions) {
      if (!session) continue
      const messages = _searchSessions(searchInput, session)
      if (messages.length === 0) continue
      matchedMessageTotal += messages.length
      batch.push({ ...session, messages })
    }
    emitBatch(batch)

    if (matchedMessageTotal >= SEARCH_RESULT_LIMIT) {
      break
    }

    cursor = page.nextCursor
    if (cursor !== null) {
      // Yield to the event loop so the UI can render progressive results
      // before we start scanning the next page.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
}

export function getCurrentThreadHistoryHash(s: Session) {
  const ret: { [firstMessageId: string]: SessionThreadBrief } = {}
  if (s.threads) {
    for (const thread of s.threads) {
      if (!thread.messages || thread.messages.length === 0) {
        continue
      }
      ret[thread.messages[0].id] = {
        id: thread.id,
        name: thread.name,
        createdAt: thread.createdAt,
        createdAtLabel: new Date(thread.createdAt).toLocaleString(),
        firstMessageId: thread.messages[0].id,
        messageCount: thread.messages.length,
      }
    }
    if (s.messages && s.messages.length > 0) {
      ret[s.messages[0].id] = {
        id: s.id,
        name: s.threadName || '',
        firstMessageId: s.messages[0].id,
        messageCount: s.messages.length,
      }
    }
  }
  return ret
}

export function getAllMessageList(s: Session) {
  let messageContext: Message[] = []
  if (s.threads) {
    for (const thread of s.threads) {
      messageContext = messageContext.concat(thread.messages)
    }
  }
  if (s.messages) {
    messageContext = messageContext.concat(s.messages)
  }
  return messageContext
}
