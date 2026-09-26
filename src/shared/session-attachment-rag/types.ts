export type SessionAttachmentStatus = 'pending' | 'indexing' | 'ready' | 'failed' | 'canceled'
export type SessionAttachmentIndexingStage = 'queued' | 'chunking' | 'embedding' | 'finalizing' | 'ready'

export interface SessionAttachmentRecord {
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
  indexingStage?: SessionAttachmentIndexingStage
  parserType?: string
  status: SessionAttachmentStatus
  error?: string
  createdAt?: string
  processingStartedAt?: string
  completedAt?: string
}

export interface SessionAttachmentParentRecord {
  id: number
  attachmentId: number
  parentOrder: number
  sectionPath?: string
  docType?: string
  pageStart?: number
  pageEnd?: number
  text: string
  tokenEstimate: number
  charCount: number
  createdAt?: string
}

export interface SessionAttachmentChunkRecord {
  id: number
  attachmentId: number
  parentId: number
  chunkOrder: number
  sectionPath?: string
  pageStart?: number
  pageEnd?: number
  rawText: string
  embeddedText: string
  tokenEstimate: number
  entities?: string[]
  keywords?: string[]
  chapterOrder?: number
  storyTime?: string
  priorityRank?: number
  kind?: string
  metadata?: Record<string, unknown>
  createdAt?: string
}

export interface CreateSessionAttachmentParams {
  sessionId: string
  messageId: string
  attachmentStorageKey: string
  filename: string
  mimeType: string
  fileSize: number
  tokenEstimate: number
  parserType?: string
}
