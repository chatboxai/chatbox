import type { PreprocessedFile, ProcessingStatus } from '../../types/input-box'

/**
 * Pure submit-gating / precondition logic for the composer, extracted from
 * `InputBox.tsx` so the "why can't I send" rules can be characterized in
 * isolation. None of these touch React state; the component wraps them in
 * `useMemo` and feeds them the current preprocessed state.
 */

type PreprocessingStatusMap = {
  files: Record<string, ProcessingStatus>
  links: Record<string, ProcessingStatus>
}

/** True while any file or link is still being preprocessed. */
export function isPreprocessingInProgress(status: PreprocessingStatusMap): boolean {
  const hasProcessingFiles = Object.values(status.files || {}).some((s) => s === 'processing')
  const hasProcessingLinks = Object.values(status.links || {}).some((s) => s === 'processing')
  return hasProcessingFiles || hasProcessingLinks
}

/** True when any file or link finished preprocessing in an error state. */
export function hasPreprocessingErrors(status: PreprocessingStatusMap): boolean {
  const hasErrorFiles = Object.values(status.files || {}).some((s) => s === 'error')
  const hasErrorLinks = Object.values(status.links || {}).some((s) => s === 'error')
  return hasErrorFiles || hasErrorLinks
}

/** A session-retrieval (RAG) file the backend refused to index — hard-blocks send. */
export function hasBlockedSessionRagFiles(files: PreprocessedFile[]): boolean {
  return files.some((file) => file.ragMode === 'session-retrieval' && file.sessionAttachmentAvailability === 'blocked')
}

/** Any usable session-retrieval file present (drives the tool-capability warning). */
export function hasSessionRetrievalFiles(files: PreprocessedFile[]): boolean {
  return files.some((file) => file.ragMode === 'session-retrieval' && file.sessionAttachmentAvailability !== 'blocked')
}

/** Any file flagged with the "large attachment" warning reason. */
export function hasLargeAttachmentWarning(files: PreprocessedFile[], warningReason: string): boolean {
  return files.some((file) => file.sessionAttachmentWarningReason === warningReason)
}

/** Nothing to send: no text and no pictures/attachments/links. */
export function computeDisableSubmit(input: {
  hasTextContent: boolean
  links?: { length: number } | null
  attachments?: { length: number } | null
  pictureKeys?: { length: number } | null
}): boolean {
  return !(input.hasTextContent || input.links?.length || input.attachments?.length || input.pictureKeys?.length)
}

/**
 * The core send-blocked predicate shared by `handleSubmit` and the send button.
 * Callers OR in their context-specific flags (`generating` for the submit guard,
 * `isCompactionRunning` for the button's disabled state).
 */
export interface SubmitBlockFlags {
  disableSubmit: boolean
  isPreprocessing: boolean
  isSubmitting: boolean
  hasPreprocessErrors: boolean
  hasBlockedSessionRagFiles: boolean
}

export function isSubmitBlocked(flags: SubmitBlockFlags): boolean {
  return (
    flags.disableSubmit ||
    flags.isPreprocessing ||
    flags.isSubmitting ||
    flags.hasPreprocessErrors ||
    flags.hasBlockedSessionRagFiles
  )
}

/**
 * Session-retrieval files that are attached but not yet `ready` — the user is
 * prompted before sending with these (unless they choose "send anyway").
 */
export function selectUnreadySessionAttachments(files: PreprocessedFile[]): PreprocessedFile[] {
  return files.filter(
    (file) =>
      file.ragMode === 'session-retrieval' &&
      file.sessionAttachmentAvailability !== 'blocked' &&
      (file.sessionAttachmentIndexStatus ?? 'pending') !== 'ready'
  )
}
