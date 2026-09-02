import { v4 as uuidv4 } from 'uuid'
import {
  type CompactionPoint,
  type Message,
  type MessageRole,
  MessageRoleEnum,
  type Session,
  type SessionThread,
  type TokenCountMap,
} from './types/session'
import type { DocumentParserConfig, DocumentParserType } from './types/settings'

export type Updater<T extends object> = Partial<T> | UpdaterFn<T>
export type UpdaterFn<T extends object> = (data: T | null | undefined) => T

export type MessageTokenCountResult = { id: string; tokenCountMap: TokenCountMap; reused: boolean }

export type SettingWindowTab = 'ai' | 'display' | 'chat' | 'advanced' | 'extension' | 'mcp'

export type ExportChatScope = 'all_threads' | 'current_thread'

export type ExportChatFormat = 'Markdown' | 'TXT' | 'HTML'

// Agent Mode
export type AgentModeValue = 'auto' | 'on' | 'off'
export type AgentModeLockReason = 'file_upload' | 'load_skill' | 'message_sent' | null

export interface AgentModeEntry {
  value: AgentModeValue
  locked: boolean
  lockReason: AgentModeLockReason
}

export function isChatSession(session: Session) {
  return session.type === 'chat' || !session.type
}
export function isPictureSession(session: Session) {
  return session.type === 'picture'
}

export function createMessage(role: MessageRole = MessageRoleEnum.User, content: string = ''): Message {
  return {
    id: uuidv4(),
    contentParts: content ? [{ type: 'text', text: content }] : [],
    role: role,
    timestamp: Date.now(),
  }
}

export type Language =
  | 'en'
  | 'zh-Hans'
  | 'zh-Hant'
  | 'ja'
  | 'ko'
  | 'ru'
  | 'de'
  | 'fr'
  | 'pt-PT'
  | 'es'
  | 'ar'
  | 'it-IT'
  | 'sv'
  | 'nb-NO'

export interface Config {
  uuid: string
}

export interface SponsorAd {
  text: string
  url: string
}

export interface SponsorAboutBanner {
  type: 'picture' | 'picture-text'
  name: string
  pictureUrl: string
  link: string
  title: string
  description: string
}

export type ImageSource =
  | {
      type: 'url'
      url: string
    }
  | {
      type: 'storage-key'
      storageKey: string
    }

export interface CopilotDetail {
  id: string
  name: string
  prompt: string
  picUrl?: string // Deprecated
  avatar?: ImageSource
  backgroundImage?: ImageSource
  description?: string
  tags?: string[]
  screenshots?: ImageSource[]
  createdAt?: number
  updatedAt?: number
  usedCount?: number
  /** If this copilot is copied from a remote copilot, sourceId stores the original copilot's id */
  sourceId?: string
  starred?: boolean
}

export interface Toast {
  id: string
  content: string
  action?: {
    label: string
    settingsPath?: string
  }
  duration?: number
}

export interface RemoteConfig {
  setting_chatboxai_first: boolean
  current_version: string
  product_ids: number[]
  knowledge_base_models?: {
    embedding: string
    vision: string
    rerank: string
  }
}

export interface SessionRagConfig {
  models: {
    embedding: string
    rerank: string
  }
  capabilities: {
    session_attachment_embedding: boolean
    session_attachment_rerank: boolean
  }
}

export interface SessionAttachmentRagDebugSnapshot {
  dbPath: string
  dbSizeBytes: number
  vectorDbPath: string
  vectorDbSizeBytes: number
  attachmentCount: number
  parentCount: number
  chunkCount: number
  vectorIndexNames: string[]
  statusCounts: {
    pending: number
    indexing: number
    ready: number
    failed: number
  }
  recentAttachments: Array<{
    id: number
    sessionId: string
    messageId: string
    filename: string
    parserType?: string
    status: 'pending' | 'indexing' | 'ready' | 'failed'
    chunkCount: number
    error?: string
    createdAt?: number
    processingStartedAt?: number
    completedAt?: number
  }>
}

export interface SessionAttachmentOwnershipClaim {
  attachmentId: number
  sessionId: string
  messageId: string
}

export interface SessionAttachmentRagMaintenanceScope {
  sessionIds: string[]
  messageIds: string[]
  /**
   * One live (session, message) claim per indexed attachment id. Rows whose
   * recorded owner is gone but that a claim can still place are rebound rather
   * than swept, so a shared attachment survives an owner removal on its own.
   */
  attachmentReferences: SessionAttachmentOwnershipClaim[]
}

export interface SessionAttachmentRagMaintenanceResult {
  interruptedFailedCount: number
  canceledPurgedCount: number
  orphanDeletedIds: number[]
}

export type ChatboxAIModel = 'chatboxai-3.5' | 'chatboxai-4' | string

export function copyMessage(source: Message): Message {
  return {
    ...source,
    id: uuidv4(),
  }
}

export function copyMessagesWithMapping(messages: Message[]): {
  messages: Message[]
  idMapping: Map<string, string>
} {
  const idMapping = new Map<string, string>()
  const newMessages = messages.map((msg) => {
    const newMsg = copyMessage(msg)
    idMapping.set(msg.id, newMsg.id)
    return newMsg
  })
  return { messages: newMessages, idMapping }
}

export function copyMessageForksWithMapping(
  source?: Session['messageForksHash'],
  initialIdMapping?: Map<string, string>
): {
  messageForksHash: Session['messageForksHash'] | undefined
  /** initialIdMapping extended with ids of messages copied inside fork lists */
  idMapping: Map<string, string>
} {
  const idMapping = new Map(initialIdMapping)
  if (!source || !initialIdMapping?.size) {
    return { messageForksHash: undefined, idMapping }
  }

  const copiedForks: NonNullable<Session['messageForksHash']> = {}
  const pendingForkIds = [...initialIdMapping.keys()]
  const visitedForkIds = new Set<string>()

  while (pendingForkIds.length > 0) {
    const forkMessageId = pendingForkIds.shift()!
    if (visitedForkIds.has(forkMessageId)) {
      continue
    }
    visitedForkIds.add(forkMessageId)

    const forkEntry = source[forkMessageId]
    const newForkMessageId = idMapping.get(forkMessageId)
    if (!forkEntry || !newForkMessageId) {
      continue
    }

    copiedForks[newForkMessageId] = {
      ...forkEntry,
      lists: forkEntry.lists.map((list) => {
        const messages = list.messages.map((message) => {
          const existingId = idMapping.get(message.id)
          if (existingId) {
            return {
              ...message,
              id: existingId,
            }
          }

          const copiedMessage = copyMessage(message)
          idMapping.set(message.id, copiedMessage.id)
          pendingForkIds.push(message.id)
          return copiedMessage
        })

        return {
          ...list,
          id: uuidv4(),
          messages,
        }
      }),
    }
  }

  return {
    messageForksHash: Object.keys(copiedForks).length > 0 ? copiedForks : undefined,
    idMapping,
  }
}

export function copyThreadsWithMapping(
  source?: SessionThread[],
  externalIdMapping?: Map<string, string>
): {
  threads: SessionThread[] | undefined
  idMapping: Map<string, string>
} {
  const idMapping = new Map(externalIdMapping)
  if (!source) {
    return {
      threads: undefined,
      idMapping,
    }
  }

  const threads = source.map((thread) => {
    // Use copyMessagesWithMapping for thread messages
    const { messages: newMessages, idMapping: threadIdMapping } = copyMessagesWithMapping(thread.messages)

    for (const [oldId, newId] of threadIdMapping) {
      idMapping.set(oldId, newId)
    }

    return {
      ...thread,
      messages: newMessages,
      createdAt: Date.now(),
      id: uuidv4(),
      // Copied with source ids; remap with remapCompactionPoints once the
      // full mapping (threads + fork lists) is known. A thread's boundary or
      // summary may live in a fork list copied after this function runs.
      compactionPoints: thread.compactionPoints?.map((cp) => ({ ...cp })),
    }
  })

  return {
    threads,
    idMapping,
  }
}

/**
 * Remap compaction point message ids after a copy. Points whose boundary or
 * summary id is missing from the mapping are dropped (the referenced message
 * was not part of the copy).
 */
export function remapCompactionPoints(
  compactionPoints: CompactionPoint[] | undefined,
  idMapping: Map<string, string>,
  logContext: string
): CompactionPoint[] | undefined {
  if (!compactionPoints) {
    return undefined
  }
  const remapped = compactionPoints
    .map((cp) => {
      const newSummaryId = idMapping.get(cp.summaryMessageId)
      const newBoundaryId = idMapping.get(cp.boundaryMessageId)
      if (!newSummaryId || !newBoundaryId) {
        console.warn(`[${logContext}] Skipping compactionPoint with unmapped IDs`, cp)
        return null
      }
      return {
        ...cp,
        summaryMessageId: newSummaryId,
        boundaryMessageId: newBoundaryId,
      }
    })
    .filter((cp): cp is NonNullable<typeof cp> => cp !== null)
  return remapped.length ? remapped : undefined
}

export function copyThreads(source?: SessionThread[], idMapping?: Map<string, string>): SessionThread[] | undefined {
  if (!source) {
    return undefined
  }
  const { threads, idMapping: fullIdMapping } = copyThreadsWithMapping(source, idMapping)
  return threads?.map((thread) => ({
    ...thread,
    compactionPoints: remapCompactionPoints(thread.compactionPoints, fullIdMapping, 'copyThreads'),
  }))
}

// RAG related types
export type KnowledgeBaseProviderMode = 'chatbox-ai' | 'custom'

export interface KnowledgeBase {
  id: number
  name: string
  embeddingModel: string
  rerankModel: string
  visionModel?: string
  providerMode?: KnowledgeBaseProviderMode
  documentParser?: DocumentParserConfig
  createdAt: number
}

export interface KnowledgeBaseFile {
  id: number
  kb_id: number
  filename: string
  filepath: string
  mime_type: string
  file_size: number
  chunk_count: number
  total_chunks: number
  status: string
  error: string
  createdAt: number
  parsed_remotely: number
  parser_type?: DocumentParserType
}

export interface KnowledgeBaseSearchResult {
  id: number
  score: number
  text: string
  fileId: number
  filename: string
  mimeType: string
  chunkIndex: number
}

export type SessionAttachmentAvailability = 'allowed' | 'blocked'
export type SessionAttachmentIndexStatus = 'pending' | 'indexing' | 'ready' | 'failed'
export type SessionAttachmentStatus = SessionAttachmentIndexStatus
export type SessionAttachmentIndexingStage = 'queued' | 'chunking' | 'embedding' | 'finalizing' | 'ready'

export interface SessionAttachmentQueryPlan {
  recallTopK: number
  finalTopK: number
  rerank?: {
    enabled: boolean
    model?: string
  }
}

export interface SessionAttachment {
  id: number
  sessionId: string
  messageId: string
  attachmentStorageKey: string
  filename: string
  mimeType: string
  fileSize: number
  tokenEstimate: number
  chunkCount?: number
  totalChunks?: number
  embeddedChunks?: number
  embeddingModel?: string
  embeddingDimension?: number
  resumable?: boolean
  indexingStage?: SessionAttachmentIndexingStage
  parserType?: string
  availability: SessionAttachmentAvailability
  indexStatus: SessionAttachmentIndexStatus
  status: SessionAttachmentStatus
  error?: string
  createdAt?: number
  processingStartedAt?: number
  completedAt?: number
}

export interface SessionAttachmentSearchResult {
  attachmentId: number
  parentId: number
  filename: string
  sectionPath?: string
  chunkOrder: number
  text: string
  score: number
}

export interface SessionAttachmentParent {
  id: number
  attachmentId: number
  filename: string
  sectionPath?: string
  docType?: string
  pageStart?: number
  pageEnd?: number
  parentOrder: number
  text: string
  tokenEstimate: number
  charCount: number
}

export type FileMeta = {
  name: string
  path: string
  type: string
  size: number
}

export * from './types/agent-persona'
export * from './types/command-execution'
export * from './types/image-generation'
export * from './types/session'
export * from './types/settings'
export * from './types/skills'
