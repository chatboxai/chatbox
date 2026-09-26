import { v4 as uuidv4 } from 'uuid'
import { getLogger } from '@/lib/utils'
import platform from '@/platform'
import { isSessionAttachmentRagSupportedFilePath } from '../../shared/file-extensions'
import { SESSION_ATTACHMENT_RAG_LOG_PREFIX } from '../../shared/session-attachment-rag/logging'
import type { MessageFile, SessionAttachment } from '../../shared/types'
import type { AttachmentPreparationResult, PreprocessedFile } from '../types/input-box'

const log = getLogger('session-attachment-rag-indexing')

import { supportsSessionAttachmentRag } from '@shared/platform'

function shouldIndexPreparedAttachment(
  file: Pick<AttachmentPreparationResult, 'ragMode' | 'storageKey' | 'error' | 'sessionAttachmentAvailability'>
) {
  return (
    supportsSessionAttachmentRag(platform.type) &&
    file.ragMode === 'session-retrieval' &&
    !!file.storageKey &&
    !file.error &&
    file.sessionAttachmentAvailability !== 'blocked'
  )
}

function shouldIndexMessageFile(file: MessageFile) {
  return (
    supportsSessionAttachmentRag(platform.type) &&
    file.ragMode === 'session-retrieval' &&
    !!file.storageKey &&
    isSessionAttachmentRagSupportedFilePath(file.name) &&
    file.sessionAttachmentAvailability !== 'blocked'
  )
}

function mapPreparedAttachmentState(
  preparedFile: AttachmentPreparationResult,
  file: File,
  attachment: SessionAttachment,
  extras: { draftMessageId?: string } = {}
): PreprocessedFile {
  return {
    ...preparedFile,
    file,
    ...extras,
    sessionAttachmentId: attachment.id,
    sessionAttachmentAvailability: attachment.availability,
    sessionAttachmentIndexStatus: attachment.indexStatus,
    sessionAttachmentChunkCount: attachment.chunkCount ?? 0,
    sessionAttachmentTotalChunks: attachment.totalChunks ?? 0,
    sessionAttachmentEmbeddedChunks: attachment.embeddedChunks ?? 0,
    sessionAttachmentIndexingStage: attachment.indexingStage,
  }
}

function mapMessageFileAttachmentState(file: MessageFile, attachment: SessionAttachment): MessageFile {
  return {
    ...file,
    sessionAttachmentId: attachment.id,
    sessionAttachmentAvailability: attachment.availability,
    sessionAttachmentIndexStatus: attachment.indexStatus,
    sessionAttachmentStatus: attachment.status,
    sessionAttachmentChunkCount: attachment.chunkCount ?? 0,
    sessionAttachmentTotalChunks: attachment.totalChunks ?? 0,
    sessionAttachmentEmbeddedChunks: attachment.embeddedChunks ?? 0,
    sessionAttachmentIndexingStage: attachment.indexingStage,
  }
}

export async function startPreparedSessionAttachmentIndexing(params: {
  file: File
  preparedFile: AttachmentPreparationResult
  sessionId: string
  draftMessageId?: string
  shouldContinue?: () => boolean
}): Promise<PreprocessedFile | undefined> {
  const { file, preparedFile, sessionId, shouldContinue } = params
  if (!isSessionAttachmentRagSupportedFilePath(file.name) || !shouldIndexPreparedAttachment(preparedFile)) {
    return preparedFile
  }

  const controller = platform.getSessionAttachmentRagController()
  const draftMessageId = params.draftMessageId || uuidv4()
  const attachmentStorageKey = preparedFile.storageKey
  log.debug(
    `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} Starting attachment indexing: file="${file.name}", session=${sessionId}, draftMessage=${draftMessageId}, parser=${preparedFile.parserType}, bytes=${preparedFile.byteLength ?? 0}`
  )
  const attachment = await controller.create({
    sessionId,
    messageId: draftMessageId,
    attachmentStorageKey,
    filename: file.name,
    mimeType: file.type,
    fileSize: preparedFile.byteLength ?? file.size ?? 0,
    tokenEstimate: preparedFile.tokenCountMap?.default ?? 0,
    parserType: preparedFile.parserType,
  })

  if (shouldContinue && !shouldContinue()) {
    log.debug(
      `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} Aborting attachment indexing after create: attachmentId=${attachment.id}, file="${file.name}"`
    )
    await controller.deleteAttachment(attachment.id)
    return undefined
  }

  return mapPreparedAttachmentState(preparedFile, file, attachment, { draftMessageId })
}

export async function ensureMessageFileSessionAttachment(params: {
  sessionId: string
  messageId: string
  file: MessageFile
}): Promise<MessageFile> {
  const { sessionId, messageId, file } = params
  if (!shouldIndexMessageFile(file)) {
    return file
  }

  const controller = platform.getSessionAttachmentRagController()
  const attachmentStorageKey = file.storageKey
  if (!attachmentStorageKey) {
    return file
  }
  if (file.sessionAttachmentId) {
    await controller.rebindAttachment({
      attachmentId: file.sessionAttachmentId,
      sessionId,
      messageId,
    })
    const [attachment] = await controller.getAttachments([file.sessionAttachmentId])
    if (attachment) {
      return mapMessageFileAttachmentState(file, attachment)
    }
    return {
      ...file,
      sessionAttachmentAvailability: 'allowed',
      sessionAttachmentIndexStatus: file.sessionAttachmentIndexStatus ?? 'pending',
      sessionAttachmentStatus: file.sessionAttachmentIndexStatus ?? file.sessionAttachmentStatus ?? 'pending',
    }
  }

  log.debug(
    `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} Creating message attachment task: session=${sessionId}, message=${messageId}, file="${file.name}", parser=${file.parserType}, bytes=${file.byteLength ?? 0}`
  )
  const attachment = await controller.create({
    sessionId,
    messageId,
    attachmentStorageKey,
    filename: file.name,
    mimeType: file.fileType,
    fileSize: file.byteLength ?? 0,
    tokenEstimate: file.tokenCountMap?.default ?? 0,
    parserType: file.parserType,
  })
  log.debug(
    `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} Message attachment task created: attachmentId=${attachment.id}, file="${file.name}", status=${attachment.status}`
  )

  return mapMessageFileAttachmentState(file, attachment)
}
