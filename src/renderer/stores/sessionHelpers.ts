import { isSessionAttachmentRagSupportedFilePath, isTextFilePath } from '@shared/file-extensions'
import type {
  ExportChatFormat,
  ExportChatScope,
  Session,
  SessionMeta,
  SessionSettings,
  SessionThread,
  SessionThreadBrief,
  Settings,
} from '@shared/types'
import type { DocumentParserConfig } from '@shared/types/settings'
import { getMessageText, migrateMessage } from '@shared/utils/message'
import { pick } from 'lodash'
import i18n from '@/i18n'
import { formatChatAsHtml, formatChatAsMarkdown, formatChatAsTxt } from '@/lib/format-chat'
import { getLogger } from '@/lib/utils'
import { PREVIEW_LINES } from '@/packages/context-management/attachment-payload'
import * as localParser from '@/packages/local-parser'
import * as remote from '@/packages/remote'
import { estimateTokens } from '@/packages/token'
import platform from '@/platform'
import storage from '@/storage'
import { StorageKey, StorageKeyGenerator } from '@/storage/StoreStorage'
import { authInfoStore } from '@/stores/authInfoStore'
import { getMetaStorage } from '@/stores/chatStore'
import { migrateSession, sortSessions } from '@/utils/session-utils'
import * as defaults from '../../shared/defaults'
import { SESSION_ATTACHMENT_RAG_LOG_PREFIX } from '../../shared/session-attachment-rag/logging'
import { createMessage, type Message, SessionSettingsSchema, TOKEN_CACHE_KEYS } from '../../shared/types'
import type { AttachmentPreparationResult, PreprocessedFile } from '../types/input-box'
import { lastUsedModelStore } from './lastUsedModelStore'
import * as settingActions from './settingActions'
import { getPlatformDefaultDocumentParser, settingsStore } from './settingsStore'

const log = getLogger('session-helpers')
const SESSION_ATTACHMENT_RAG_INLINE_BYTE_THRESHOLD = 256 * 1024
export const SESSION_ATTACHMENT_RAG_MAX_PARSED_BYTE_LENGTH = 6 * 1024 * 1024
export const SESSION_ATTACHMENT_RAG_REQUIRES_CHATBOX_AI_ERROR = 'session_attachment_rag_requires_chatbox_ai'
export const SESSION_ATTACHMENT_RAG_REQUIRES_KNOWLEDGE_BASE_ERROR = 'session_attachment_rag_requires_knowledge_base'
export const SESSION_ATTACHMENT_RAG_REQUIRES_TOOL_USE_MODEL_ERROR = 'session_attachment_rag_requires_tool_use_model'
export const SESSION_ATTACHMENT_RAG_PARSED_CONTENT_TOO_LARGE_ERROR = 'session_attachment_rag_parsed_content_too_large'
export const SESSION_ATTACHMENT_RAG_LARGE_ATTACHMENT_WARNING = 'session_attachment_rag_large_attachment_warning'
const SESSION_ATTACHMENT_RAG_AUTH_ERROR_PATTERNS = [
  'provider chatbox-ai not set',
  'chatbox-ai not set',
  'missing token for rerank provider: chatbox-ai',
]
const SESSION_ATTACHMENT_RAG_INDEXING_ERROR_PATTERNS = [
  'chatbox_session_rag_vectors.db',
  'connectionfailed("unable to open connection to local database',
  'session attachment rag vector store not initialized',
]
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

function canFallbackToChatboxAI(): boolean {
  return Boolean(settingActions.getLicenseKey())
}

export function isSessionAttachmentRagAuthError(errorCode: string | undefined): boolean {
  if (!errorCode) {
    return false
  }
  if (errorCode === SESSION_ATTACHMENT_RAG_REQUIRES_CHATBOX_AI_ERROR) {
    return true
  }
  const normalized = errorCode.toLowerCase()
  return SESSION_ATTACHMENT_RAG_AUTH_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern))
}

export function isSessionAttachmentRagIndexingError(errorCode: string | undefined): boolean {
  if (!errorCode) {
    return false
  }
  const normalized = errorCode.toLowerCase()
  return SESSION_ATTACHMENT_RAG_INDEXING_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern))
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

async function canUseSessionAttachmentRag(): Promise<boolean> {
  const licenseKey = settingActions.getLicenseKey() || ''
  const hasUsableLicense = hasUsableSessionAttachmentRagLicense()
  const capabilityCacheKey = `${licenseKey}:${hasUsableLicense ? 'active' : 'inactive'}`
  if (sessionRagCapabilityCache?.key === capabilityCacheKey) {
    log.debug(
      `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} Capability cache hit: embedding=${sessionRagCapabilityCache.value}, hasLicense=${Boolean(licenseKey)}`
    )
    return sessionRagCapabilityCache.value
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
async function parseFileWithLocalParser(
  file: File,
  uniqKey: string
): Promise<{ content: string; storageKey: string; tokenCountMap: Record<string, number>; parserType: string }> {
  const result = await platform.parseFileLocally(file)

  if (!result.isSupported || !result.key) {
    throw new Error('local_parser_failed')
  }

  // Get content from temporary storage
  const content = (await storage.getBlob(result.key).catch(() => '')) || ''

  // Store content to unique key
  if (content) {
    await storage.setBlob(uniqKey, content)
  }

  return { content, storageKey: uniqKey, tokenCountMap: {}, parserType: 'local' }
}

async function fallbackToChatboxAIParser(
  file: File,
  uniqKey: string,
  reason: 'local_parser_failed' | 'empty_content'
): Promise<{ content: string; storageKey: string; tokenCountMap: Record<string, number>; parserType: string }> {
  log.warn(`Falling back to Chatbox AI parser for "${file.name}" due to ${reason}`)

  try {
    return await parseFileWithChatboxAI(file, uniqKey)
  } catch (error) {
    log.error(`Chatbox AI fallback parsing failed for "${file.name}":`, error)
    throw new Error('chatbox_ai_parser_failed')
  }
}

async function parseFileWithLocalFallback(
  file: File,
  uniqKey: string
): Promise<{ content: string; storageKey: string; tokenCountMap: Record<string, number>; parserType: string }> {
  try {
    const result = await parseFileWithLocalParser(file, uniqKey)
    if (!hasParsedText(result.content) && canFallbackToChatboxAI()) {
      return await fallbackToChatboxAIParser(file, uniqKey, 'empty_content')
    }
    return result
  } catch (error) {
    log.error(`Local parsing failed for "${file.name}":`, error)

    if (canFallbackToChatboxAI()) {
      return await fallbackToChatboxAIParser(file, uniqKey, 'local_parser_failed')
    }

    throw new Error('local_parser_failed')
  }
}

/**
 * Parse file using Chatbox AI cloud service
 */
async function parseFileWithChatboxAI(
  file: File,
  uniqKey: string
): Promise<{ content: string; storageKey: string; tokenCountMap: Record<string, number>; parserType: string }> {
  const licenseKey = settingActions.getLicenseKey()
  const uploadedKey = await remote.uploadAndCreateUserFile(licenseKey || '', file)

  // Get uploaded file content
  const content = (await storage.getBlob(uploadedKey).catch(() => '')) || ''

  // Store content to unique key
  if (content) {
    await storage.setBlob(uniqKey, content)
  }

  return { content, storageKey: uniqKey, tokenCountMap: {}, parserType: 'chatbox-ai' }
}

/**
 * Parse file using MinerU service (Desktop only)
 */
async function parseFileWithMineruService(
  file: File,
  uniqKey: string,
  apiToken: string
): Promise<{ content: string; storageKey: string; tokenCountMap: Record<string, number>; parserType: string }> {
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

  if (!result.success || !result.content) {
    throw new Error('third_party_parser_failed')
  }

  const content = result.content

  // Store content to unique key
  await storage.setBlob(uniqKey, content)

  return { content, storageKey: uniqKey, tokenCountMap: {}, parserType: 'mineru' }
}

/**
 * 预处理文件以获取内容和存储键
 * @param file 文件对象
 * @param settings 会话设置
 * @returns 预处理后的文件信息
 */
export async function prepareFileAttachment(
  file: File,
  settings: SessionSettings
): Promise<AttachmentPreparationResult> {
  try {
    const uniqKey = StorageKeyGenerator.fileUniqKey(file)

    // Check if file has already been processed (cache hit)
    const existingContent = await storage.getBlob(uniqKey).catch(() => null)
    if (existingContent) {
      log.debug(`File already preprocessed: ${file.name}, using cached content.`)
      const existingTokenMap: Record<string, number> = (await storage.getItem(`${uniqKey}_tokenMap`, {})) as Record<
        string,
        number
      >
      const existingParserType = (await storage.getItem<string | undefined>(`${uniqKey}_parserType`, undefined)) as
        | string
        | undefined

      const stats = getContentStats(existingContent)
      const sessionAttachmentWarningReason = isParsedContentVeryLarge(stats)
        ? SESSION_ATTACHMENT_RAG_LARGE_ATTACHMENT_WARNING
        : undefined
      if (sessionAttachmentWarningReason) {
        log.info(
          `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} Cached parsed content is very large: file="${file.name}", bytes=${stats.byteLength}, limit=${SESSION_ATTACHMENT_RAG_MAX_PARSED_BYTE_LENGTH}`
        )
      }

      const isSessionAttachmentRagFileType = isSessionAttachmentRagSupportedFilePath(file.name)
      const exceedsSessionAttachmentRagThreshold =
        platform.type === 'desktop' &&
        isSessionAttachmentRagFileType &&
        stats.byteLength > SESSION_ATTACHMENT_RAG_INLINE_BYTE_THRESHOLD
      const sessionAttachmentRagAllowed = exceedsSessionAttachmentRagThreshold
        ? await canUseSessionAttachmentRag()
        : false
      const shouldUseSessionAttachmentRag =
        exceedsSessionAttachmentRagThreshold && sessionAttachmentRagAllowed && !sessionAttachmentWarningReason
      const { lineCount, byteLength, tokenCountMap } = computePreviewMetadata(existingContent, existingTokenMap, {
        includeFullTokenCounts: !shouldUseSessionAttachmentRag,
        stats,
      })
      log.debug(
        `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} Cached preprocess decision: file="${file.name}", bytes=${stats.byteLength}, tokens=${tokenCountMap[TOKEN_CACHE_KEYS.default] ?? 0}, ragFileType=${isSessionAttachmentRagFileType}, exceedsThreshold=${exceedsSessionAttachmentRagThreshold}, ragMode=${shouldUseSessionAttachmentRag ? 'session-retrieval' : 'inline'}, allowed=${sessionAttachmentRagAllowed}`
      )

      await storage.setItem(`${uniqKey}_tokenMap`, tokenCountMap)

      return {
        file,
        content: existingContent,
        storageKey: uniqKey,
        ragMode: shouldUseSessionAttachmentRag ? 'session-retrieval' : 'inline',
        parserType: existingParserType,
        tokenCountMap,
        lineCount,
        byteLength,
        sessionAttachmentAvailability: 'allowed',
        sessionAttachmentWarningReason,
      }
    }

    let result: { content: string; storageKey: string; tokenCountMap: Record<string, number>; parserType: string }
    if (isTextFilePath(file.name)) {
      log.debug(`Text file detected, using local parser: ${file.name}`)
      result = await parseFileWithLocalFallback(file, uniqKey)
    } else {
      const parserConfig = getEffectiveDocumentParserConfig()
      log.debug(`Using document parser: ${parserConfig.type} for file: ${file.name}`)

      switch (parserConfig.type) {
        case 'none': {
          throw new Error('document_parser_not_configured')
        }

        case 'local': {
          result = await parseFileWithLocalFallback(file, uniqKey)
          break
        }

        case 'chatbox-ai': {
          try {
            result = await parseFileWithChatboxAI(file, uniqKey)
          } catch (error) {
            log.error(`Chatbox AI parsing failed for "${file.name}":`, error)
            throw new Error('chatbox_ai_parser_failed')
          }
          break
        }

        case 'mineru': {
          const apiToken = parserConfig.mineru?.apiToken
          if (!apiToken) {
            throw new Error('mineru_api_token_required')
          }
          try {
            result = await parseFileWithMineruService(file, uniqKey, apiToken)
          } catch (error) {
            log.error(`MinerU parsing failed for "${file.name}":`, error)
            if (error instanceof Error && error.message.startsWith('third_party_parser')) {
              throw error
            }
            throw new Error('third_party_parser_failed')
          }
          break
        }

        default: {
          throw new Error('document_parser_not_configured')
        }
      }
    }

    const stats = getContentStats(result.content)
    const sessionAttachmentWarningReason = isParsedContentVeryLarge(stats)
      ? SESSION_ATTACHMENT_RAG_LARGE_ATTACHMENT_WARNING
      : undefined
    if (sessionAttachmentWarningReason) {
      log.info(
        `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} Parsed content is very large: file="${file.name}", parser=${result.parserType}, bytes=${stats.byteLength}, limit=${SESSION_ATTACHMENT_RAG_MAX_PARSED_BYTE_LENGTH}`
      )
    }

    const isSessionAttachmentRagFileType = isSessionAttachmentRagSupportedFilePath(file.name)
    const exceedsSessionAttachmentRagThreshold =
      platform.type === 'desktop' &&
      isSessionAttachmentRagFileType &&
      stats.byteLength > SESSION_ATTACHMENT_RAG_INLINE_BYTE_THRESHOLD
    const sessionAttachmentRagAllowed = exceedsSessionAttachmentRagThreshold
      ? await canUseSessionAttachmentRag()
      : false
    const shouldUseSessionAttachmentRag =
      exceedsSessionAttachmentRagThreshold && sessionAttachmentRagAllowed && !sessionAttachmentWarningReason
    const { lineCount, byteLength, tokenCountMap } = computePreviewMetadata(result.content, result.tokenCountMap, {
      includeFullTokenCounts: !shouldUseSessionAttachmentRag,
      stats,
    })
    await storage.setItem(`${result.storageKey}_tokenMap`, tokenCountMap)
    await storage.setItem(`${result.storageKey}_parserType`, result.parserType)

    log.debug(
      `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} Preprocess decision: file="${file.name}", parser=${result.parserType}, bytes=${stats.byteLength}, tokens=${tokenCountMap[TOKEN_CACHE_KEYS.default] ?? 0}, ragFileType=${isSessionAttachmentRagFileType}, exceedsThreshold=${exceedsSessionAttachmentRagThreshold}, ragMode=${shouldUseSessionAttachmentRag ? 'session-retrieval' : 'inline'}, allowed=${sessionAttachmentRagAllowed}`
    )

    return {
      file,
      content: result.content,
      storageKey: result.storageKey,
      ragMode: shouldUseSessionAttachmentRag ? 'session-retrieval' : 'inline',
      parserType: result.parserType,
      tokenCountMap,
      lineCount,
      byteLength,
      sessionAttachmentAvailability: 'allowed',
      sessionAttachmentWarningReason,
    }
  } catch (error) {
    log.error(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} Failed to preprocess file "${file.name}":`, error)
    return {
      file,
      content: '',
      storageKey: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
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
        f.ragMode === 'session-retrieval' ? undefined : f.localPath || platform.getLocalFilePath(f.file) || undefined

      return {
        id: f.storageKey || f.file.name,
        name: f.file.name,
        fileType: f.file.type,
        parserType: f.parserType,
        storageKey: f.storageKey || undefined,
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

export async function exportChat(session: Session, scope: ExportChatScope, format: ExportChatFormat) {
  const threads: SessionThread[] = scope === 'all_threads' ? [...(session.threads || [])] : []
  threads.push({
    id: session.id,
    name: session.threadName || session.name,
    messages: session.messages,
    createdAt: Date.now(),
  })

  if (format === 'Markdown') {
    const content = formatChatAsMarkdown(session.name, threads)
    platform.exporter.exportTextFile(`${session.name}.md`, content)
  } else if (format === 'TXT') {
    const content = formatChatAsTxt(session.name, threads)
    platform.exporter.exportTextFile(`${session.name}.txt`, content)
  } else if (format === 'HTML') {
    const content = await formatChatAsHtml(session.name, threads)
    platform.exporter.exportTextFile(`${session.name}.html`, content)
  }
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
  const newSession: Omit<Session, 'id'> = {
    name: 'Untitled',
    type: 'chat',
    messages: [],
    settings: {
      maxContextMessageCount: settings.maxContextMessageCount ?? Number.MAX_SAFE_INTEGER,
      temperature: settings.temperature || undefined,
      topP: settings.topP || undefined,
      ...(settings.defaultChatModel
        ? {
            provider: settings.defaultChatModel.provider,
            modelId: settings.defaultChatModel.model,
          }
        : lastUsedChatModel),
    },
  }
  if (settings.defaultPrompt) {
    newSession.messages.push(createMessage('system', settings.defaultPrompt || defaults.getDefaultPrompt()))
  }
  return newSession
}

export function initEmptyPictureSession(): Omit<Session, 'id'> {
  const { picture: lastUsedPictureModel } = lastUsedModelStore.getState()

  return {
    name: 'Untitled',
    type: 'picture',
    messages: [createMessage('system', i18n.t('Image Creator Intro') || '')],
    settings: {
      ...lastUsedPictureModel,
    },
  }
}

export function getSessionMeta(session: SessionMeta) {
  return pick(session, [
    'id',
    'name',
    'starred',
    'hidden',
    'assistantAvatarKey',
    'picUrl',
    'backgroundImage',
    'type',
    'groupId',
    'system',
    'sortIndex',
  ])
}

function _searchSessions(regexp: RegExp, s: Session) {
  const session = migrateSession(s)
  const matchedMessages: Message[] = []
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const message = session.messages[i]
    if (regexp.test(getMessageText(message))) {
      matchedMessages.push(message)
    }
  }
  // 搜索会话的历史主题
  if (session.threads) {
    for (let i = session.threads.length - 1; i >= 0; i--) {
      const thread = session.threads[i]
      for (let j = thread.messages.length - 1; j >= 0; j--) {
        const message = thread.messages[j]
        if (regexp.test(getMessageText(message))) {
          matchedMessages.push(message)
        }
      }
    }
  }
  return matchedMessages.map((m) => migrateMessage(m))
}

const SEARCH_PAGE_SIZE = 30
const SEARCH_RESULT_LIMIT = 50

export async function searchSessions(searchInput: string, sessionId?: string, onResult?: (result: Session[]) => void) {
  const safeInput = searchInput.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
  const regexp = new RegExp(safeInput, 'i')
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
      const matchedMessages = _searchSessions(regexp, session)
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
      const messages = _searchSessions(regexp, session)
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
