import type {
  Message,
  SessionAttachmentAvailability,
  SessionAttachmentIndexingStage,
  SessionAttachmentIndexStatus,
} from '../../shared/types'

export type ProcessingStatus = 'processing' | 'completed' | 'error' | undefined

export type AttachmentPreparationResult = {
  file: File
  content: string
  storageKey: string
  rawStorageKey?: string
  localPath?: string
  ragMode?: 'inline' | 'session-retrieval'
  parserType?: string
  sessionAttachmentAvailability?: SessionAttachmentAvailability
  sessionAttachmentBlockedReason?: string
  sessionAttachmentWarningReason?: string
  tokenCountMap?: Record<string, number>
  lineCount?: number
  byteLength?: number
  error?: string
}

export type SessionAttachmentIndexingState = {
  draftMessageId?: string
  sessionAttachmentId?: number
  sessionAttachmentIndexStatus?: SessionAttachmentIndexStatus
  sessionAttachmentChunkCount?: number
  sessionAttachmentTotalChunks?: number
  sessionAttachmentEmbeddedChunks?: number
  sessionAttachmentResumable?: boolean
  sessionAttachmentIndexingStage?: SessionAttachmentIndexingStage
}

export type PreprocessedFile = AttachmentPreparationResult & SessionAttachmentIndexingState

export type PreprocessedLink = {
  url: string
  title: string
  content: string
  storageKey: string
  error?: string
}

export type PreConstructedMessageState = {
  draftMessageId?: string
  text: string
  pictureKeys: string[]
  attachments: File[]
  links: { url: string }[]
  preprocessedFiles: PreprocessedFile[]
  preprocessedLinks: PreprocessedLink[]
  message?: Message
  preprocessingStatus: {
    files: Record<string, ProcessingStatus>
    links: Record<string, ProcessingStatus>
  }
  preprocessingPromises: {
    files: Map<string, Promise<unknown>>
    links: Map<string, Promise<unknown>>
  }
}
