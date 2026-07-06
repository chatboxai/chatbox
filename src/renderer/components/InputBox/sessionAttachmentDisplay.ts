import type {
  SessionAttachment,
  SessionAttachmentIndexingStage,
  SessionAttachmentIndexStatus,
} from '../../../shared/types'
import type { PreprocessedFile, ProcessingStatus } from '../../types/input-box'

/**
 * Pure display/derivation logic for session-attachment (RAG) chat files, extracted
 * from `InputBox.tsx` so it can be characterized in isolation. None of these functions
 * touch React state or the DOM — the component feeds them the current attachment maps
 * and renders the returned shape.
 */

/**
 * Fold the latest `SessionAttachment` indexing states back into the preprocessed-file
 * list, preserving object identity for unchanged files so React can skip re-renders.
 * `changed` is true iff at least one file's tracked fields moved.
 */
export function mergeSessionAttachmentStatesIntoFiles(
  files: PreprocessedFile[],
  attachments: SessionAttachment[]
): { files: PreprocessedFile[]; changed: boolean } {
  if (files.length === 0 || attachments.length === 0) {
    return { files, changed: false }
  }

  const attachmentStateMap = new Map(attachments.map((attachment) => [attachment.id, attachment]))
  let changed = false
  const nextFiles = files.map((file) => {
    if (!file.sessionAttachmentId) {
      return file
    }
    const attachment = attachmentStateMap.get(file.sessionAttachmentId)
    if (!attachment) {
      return file
    }
    const nextFile = {
      ...file,
      sessionAttachmentAvailability: attachment.availability ?? file.sessionAttachmentAvailability,
      sessionAttachmentIndexStatus: attachment.indexStatus ?? file.sessionAttachmentIndexStatus,
      sessionAttachmentChunkCount: attachment.chunkCount ?? file.sessionAttachmentChunkCount,
      sessionAttachmentTotalChunks: attachment.totalChunks ?? file.sessionAttachmentTotalChunks,
      sessionAttachmentEmbeddedChunks: attachment.embeddedChunks ?? file.sessionAttachmentEmbeddedChunks,
      sessionAttachmentIndexingStage: attachment.indexingStage ?? file.sessionAttachmentIndexingStage,
      error: attachment.error ?? file.error,
    }
    const fileChanged =
      nextFile.sessionAttachmentAvailability !== file.sessionAttachmentAvailability ||
      nextFile.sessionAttachmentIndexStatus !== file.sessionAttachmentIndexStatus ||
      nextFile.sessionAttachmentChunkCount !== file.sessionAttachmentChunkCount ||
      nextFile.sessionAttachmentTotalChunks !== file.sessionAttachmentTotalChunks ||
      nextFile.sessionAttachmentEmbeddedChunks !== file.sessionAttachmentEmbeddedChunks ||
      nextFile.sessionAttachmentIndexingStage !== file.sessionAttachmentIndexingStage ||
      nextFile.error !== file.error
    if (fileChanged) {
      changed = true
    }
    return fileChanged ? nextFile : file
  })

  return { files: nextFiles, changed }
}

/** Percent (0–100, rounded) of chunks embedded, or undefined when totals are unknown. */
export function getSessionAttachmentProgressValue(embeddedChunks?: number, totalChunks?: number): number | undefined {
  if (!totalChunks || totalChunks <= 0 || embeddedChunks === undefined) return undefined
  return Math.max(0, Math.min(100, Math.round((embeddedChunks / totalChunks) * 100)))
}

/** Human label for an indexing stage; falls back to a generic "Indexing" string. */
export function getSessionAttachmentStageLabel(
  stage: SessionAttachmentIndexingStage | undefined,
  t: (key: string) => string
): string {
  switch (stage) {
    case 'queued':
      return t('Queued')
    case 'chunking':
      return t('Preparing')
    case 'embedding':
      return t('Indexing')
    case 'finalizing':
      return t('Finishing')
    case 'ready':
      return t('Indexed')
    default:
      return t('Indexing')
  }
}

/** Live indexing progress for one attachment, as tracked by the input box query. */
export interface AttachmentProgressInfo {
  totalChunks: number
  embeddedChunks: number
  indexingStage?: SessionAttachmentIndexingStage
  processingStartedAt?: number
}

export interface AttachmentCardStateInput {
  /** `preprocessingStatus.files[fileKey]` for this file. */
  fileStatus: ProcessingStatus
  preprocessedFile: PreprocessedFile | undefined
  /** Latest index status / error / progress keyed by session-attachment id. */
  indexStatusMap: ReadonlyMap<number, SessionAttachmentIndexStatus | undefined>
  errorMap: ReadonlyMap<number, string | undefined>
  progressMap: ReadonlyMap<number, AttachmentProgressInfo>
  t: (key: string) => string
  /** Injectable clock so the ">30s → Still indexing" branch is testable. */
  now?: number
}

export interface AttachmentCardState {
  /** Status passed to `FileMiniCard` (RAG-aware, error-first). */
  cardStatus: ProcessingStatus
  statusText: string | undefined
  progressValue: number | undefined
  isTakingLong: boolean
  errorMessage: string | undefined
}

/**
 * Derive everything the attachment mini-card needs from the raw preprocessing status
 * plus the live session-attachment maps. Mirrors the original inline render logic:
 * live map values win over the file's snapshot, session-retrieval files show a
 * stage/percent label until `ready`, and anything stuck >30s reads "Still indexing".
 */
export function deriveAttachmentCardState(input: AttachmentCardStateInput): AttachmentCardState {
  const { fileStatus, preprocessedFile, indexStatusMap, errorMap, progressMap, t, now = Date.now() } = input
  const sessionAttachmentId = preprocessedFile?.sessionAttachmentId

  const effectiveIndexStatus = sessionAttachmentId
    ? (indexStatusMap.get(sessionAttachmentId) ?? preprocessedFile?.sessionAttachmentIndexStatus)
    : preprocessedFile?.sessionAttachmentIndexStatus
  const effectiveAttachmentError = sessionAttachmentId
    ? (errorMap.get(sessionAttachmentId) ?? preprocessedFile?.error)
    : preprocessedFile?.error
  const attachmentProgress = sessionAttachmentId ? progressMap.get(sessionAttachmentId) : undefined

  const totalChunks = attachmentProgress?.totalChunks ?? preprocessedFile?.sessionAttachmentTotalChunks ?? 0
  const embeddedChunks = attachmentProgress?.embeddedChunks ?? preprocessedFile?.sessionAttachmentEmbeddedChunks ?? 0
  const indexingStage = attachmentProgress?.indexingStage ?? preprocessedFile?.sessionAttachmentIndexingStage
  const progressValue = getSessionAttachmentProgressValue(embeddedChunks, totalChunks)
  const isTakingLong =
    !!attachmentProgress?.processingStartedAt &&
    effectiveIndexStatus !== 'ready' &&
    now - attachmentProgress.processingStartedAt > 30000

  const statusText =
    preprocessedFile?.ragMode === 'session-retrieval' && effectiveIndexStatus !== 'ready'
      ? progressValue !== undefined
        ? `${isTakingLong ? t('Still indexing') : getSessionAttachmentStageLabel(indexingStage, t)} · ${progressValue}%`
        : isTakingLong
          ? t('Still indexing')
          : getSessionAttachmentStageLabel(indexingStage, t)
      : fileStatus === 'processing'
        ? t('Preparing')
        : undefined

  const cardStatus: ProcessingStatus = effectiveAttachmentError
    ? 'error'
    : preprocessedFile?.ragMode === 'session-retrieval'
      ? effectiveIndexStatus === 'ready'
        ? 'completed'
        : 'processing'
      : fileStatus

  return { cardStatus, statusText, progressValue, isTakingLong, errorMessage: effectiveAttachmentError }
}
