import type { SessionAttachment } from '@shared/types'
import type { PreprocessedFile } from '@/types/input-box'

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
      sessionAttachmentResumable: attachment.resumable ?? file.sessionAttachmentResumable,
      sessionAttachmentIndexingStage: attachment.indexingStage ?? file.sessionAttachmentIndexingStage,
      // A recovery action clears the persisted attachment error. Do not fall back to the stale draft error.
      error: attachment.error,
    }
    const fileChanged =
      nextFile.sessionAttachmentAvailability !== file.sessionAttachmentAvailability ||
      nextFile.sessionAttachmentIndexStatus !== file.sessionAttachmentIndexStatus ||
      nextFile.sessionAttachmentChunkCount !== file.sessionAttachmentChunkCount ||
      nextFile.sessionAttachmentTotalChunks !== file.sessionAttachmentTotalChunks ||
      nextFile.sessionAttachmentEmbeddedChunks !== file.sessionAttachmentEmbeddedChunks ||
      nextFile.sessionAttachmentResumable !== file.sessionAttachmentResumable ||
      nextFile.sessionAttachmentIndexingStage !== file.sessionAttachmentIndexingStage ||
      nextFile.error !== file.error
    if (fileChanged) {
      changed = true
    }
    return fileChanged ? nextFile : file
  })

  return { files: nextFiles, changed }
}

export function shouldRefetchSessionAttachmentStates(
  attachments: SessionAttachment[],
  expectedAttachmentCount: number
): boolean {
  return (
    attachments.length < expectedAttachmentCount ||
    attachments.some((attachment) => attachment.indexStatus === 'pending' || attachment.indexStatus === 'indexing')
  )
}
