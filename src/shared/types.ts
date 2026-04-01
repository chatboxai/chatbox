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

export type ChatboxAIModel = 'chatboxai-3.5' | 'chatboxai-4' | string

export function copyMessage(source: Message): Message {
  return {
    ...source,
    cancel: undefined,
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

export function copyThreads(source?: SessionThread[], idMapping?: Map<string, string>): SessionThread[] | undefined {
  if (!source) {
    return undefined
  }
  return source.map((thread) => {
    // Use copyMessagesWithMapping for thread messages
    const { messages: newMessages, idMapping: threadIdMapping } = copyMessagesWithMapping(thread.messages)

    // Combine external mapping (if provided) with thread mapping
    const combinedMapping = idMapping ? new Map([...idMapping, ...threadIdMapping]) : threadIdMapping

    // Map compactionPoints (if they exist)
    const newCompactionPoints = thread.compactionPoints
      ?.map((cp) => {
        const newSummaryId = combinedMapping.get(cp.summaryMessageId)
        const newBoundaryId = combinedMapping.get(cp.boundaryMessageId)
        // Skip compactionPoints with unmapped IDs
        if (!newSummaryId || !newBoundaryId) {
          console.warn('[copyThreads] Skipping compactionPoint with unmapped IDs', cp)
          return null
        }
        return {
          ...cp,
          summaryMessageId: newSummaryId,
          boundaryMessageId: newBoundaryId,
        }
      })
      .filter((cp): cp is NonNullable<typeof cp> => cp !== null)

    return {
      ...thread,
      messages: newMessages,
      createdAt: Date.now(),
      id: uuidv4(),
      // Preserve undefined if no compactionPoints, empty array if had some but all were invalid
      compactionPoints: newCompactionPoints?.length ? newCompactionPoints : thread.compactionPoints ? [] : undefined,
    }
  })
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

export type FileMeta = {
  name: string
  path: string
  type: string
  size: number
}

export * from './types/image-generation'
export * from './types/session'
export * from './types/settings'
