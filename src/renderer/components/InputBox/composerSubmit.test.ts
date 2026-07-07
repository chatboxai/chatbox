import { describe, expect, it } from 'vitest'
import type { PreprocessedFile, ProcessingStatus } from '../../types/input-box'
import {
  computeDisableSubmit,
  hasBlockedSessionRagFiles,
  hasLargeAttachmentWarning,
  hasPreprocessingErrors,
  hasSessionRetrievalFiles,
  isPreprocessingInProgress,
  isSubmitBlocked,
  type SubmitBlockFlags,
  selectUnreadySessionAttachments,
} from './composerSubmit'

function pf(overrides: Partial<PreprocessedFile> = {}): PreprocessedFile {
  return { content: '', storageKey: '', ...overrides } as PreprocessedFile
}

function status(
  files: Record<string, ProcessingStatus> = {},
  links: Record<string, ProcessingStatus> = {}
): { files: Record<string, ProcessingStatus>; links: Record<string, ProcessingStatus> } {
  return { files, links }
}

describe('isPreprocessingInProgress', () => {
  it('is false when nothing is processing', () => {
    expect(isPreprocessingInProgress(status({ a: 'completed' }, { b: 'error' }))).toBe(false)
  })
  it('is true when a file or a link is processing', () => {
    expect(isPreprocessingInProgress(status({ a: 'processing' }))).toBe(true)
    expect(isPreprocessingInProgress(status({}, { b: 'processing' }))).toBe(true)
  })
})

describe('hasPreprocessingErrors', () => {
  it('is true when a file or a link errored', () => {
    expect(hasPreprocessingErrors(status({ a: 'error' }))).toBe(true)
    expect(hasPreprocessingErrors(status({}, { b: 'error' }))).toBe(true)
  })
  it('is false otherwise', () => {
    expect(hasPreprocessingErrors(status({ a: 'processing' }, { b: 'completed' }))).toBe(false)
  })
})

describe('session-retrieval file predicates', () => {
  const blocked = pf({ ragMode: 'session-retrieval', sessionAttachmentAvailability: 'blocked' })
  const allowed = pf({ ragMode: 'session-retrieval', sessionAttachmentAvailability: 'allowed' })
  const inline = pf({ ragMode: 'inline' })

  it('hasBlockedSessionRagFiles only counts blocked RAG files', () => {
    expect(hasBlockedSessionRagFiles([allowed, inline])).toBe(false)
    expect(hasBlockedSessionRagFiles([allowed, blocked])).toBe(true)
  })

  it('hasSessionRetrievalFiles counts non-blocked RAG files only', () => {
    expect(hasSessionRetrievalFiles([blocked, inline])).toBe(false)
    expect(hasSessionRetrievalFiles([allowed])).toBe(true)
  })

  it('hasLargeAttachmentWarning matches the given warning reason', () => {
    const warned = pf({ sessionAttachmentWarningReason: 'large' })
    expect(hasLargeAttachmentWarning([warned], 'large')).toBe(true)
    expect(hasLargeAttachmentWarning([warned], 'other')).toBe(false)
    expect(hasLargeAttachmentWarning([inline], 'large')).toBe(false)
  })
})

describe('computeDisableSubmit', () => {
  it('disables when there is no text and nothing attached', () => {
    expect(computeDisableSubmit({ hasTextContent: false })).toBe(true)
    expect(computeDisableSubmit({ hasTextContent: false, links: [], attachments: [], pictureKeys: [] })).toBe(true)
  })
  it('enables when text or any attachment is present', () => {
    expect(computeDisableSubmit({ hasTextContent: true })).toBe(false)
    expect(
      computeDisableSubmit({ hasTextContent: false, links: [{ length: 1 }] as unknown as { length: number } })
    ).toBe(false)
    expect(computeDisableSubmit({ hasTextContent: false, attachments: { length: 2 } })).toBe(false)
    expect(computeDisableSubmit({ hasTextContent: false, pictureKeys: { length: 3 } })).toBe(false)
  })
})

describe('isSubmitBlocked', () => {
  const clear: SubmitBlockFlags = {
    disableSubmit: false,
    isPreprocessing: false,
    isSubmitting: false,
    hasPreprocessErrors: false,
    hasBlockedSessionRagFiles: false,
  }

  it('is false when every flag is clear', () => {
    expect(isSubmitBlocked(clear)).toBe(false)
  })

  it('is true when any single flag is set', () => {
    for (const key of Object.keys(clear) as (keyof SubmitBlockFlags)[]) {
      expect(isSubmitBlocked({ ...clear, [key]: true })).toBe(true)
    }
  })
})

describe('selectUnreadySessionAttachments', () => {
  it('returns only non-blocked RAG files that are not yet ready', () => {
    const ready = pf({
      ragMode: 'session-retrieval',
      sessionAttachmentAvailability: 'allowed',
      sessionAttachmentIndexStatus: 'ready',
    })
    const pending = pf({
      ragMode: 'session-retrieval',
      sessionAttachmentAvailability: 'allowed',
      sessionAttachmentIndexStatus: 'pending',
    })
    const blocked = pf({ ragMode: 'session-retrieval', sessionAttachmentAvailability: 'blocked' })
    const inline = pf({ ragMode: 'inline' })
    // A RAG file with no index status defaults to 'pending' → unready.
    const noStatus = pf({ ragMode: 'session-retrieval', sessionAttachmentAvailability: 'allowed' })

    expect(selectUnreadySessionAttachments([ready, pending, blocked, inline, noStatus])).toEqual([pending, noStatus])
  })
})
