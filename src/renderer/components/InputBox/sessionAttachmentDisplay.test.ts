import { describe, expect, it } from 'vitest'
import type { SessionAttachment } from '../../../shared/types'
import type { PreprocessedFile } from '../../types/input-box'
import {
  type AttachmentProgressInfo,
  deriveAttachmentCardState,
  getSessionAttachmentProgressValue,
  getSessionAttachmentStageLabel,
  mergeSessionAttachmentStatesIntoFiles,
} from './sessionAttachmentDisplay'

// Identity translator so assertions read against the raw i18n keys.
const t = (key: string) => key

// PreprocessedFile only needs its session-attachment fields here; `.file` is never read.
function pf(overrides: Partial<PreprocessedFile> = {}): PreprocessedFile {
  return { content: '', storageKey: '', ...overrides } as PreprocessedFile
}

function attachment(overrides: Partial<SessionAttachment> = {}): SessionAttachment {
  return { id: 1, availability: 'allowed', indexStatus: 'pending', ...overrides } as SessionAttachment
}

describe('getSessionAttachmentProgressValue', () => {
  it('returns undefined when totals are unknown or zero', () => {
    expect(getSessionAttachmentProgressValue(5, 0)).toBeUndefined()
    expect(getSessionAttachmentProgressValue(5, undefined)).toBeUndefined()
    expect(getSessionAttachmentProgressValue(undefined, 10)).toBeUndefined()
  })

  it('rounds the percentage', () => {
    expect(getSessionAttachmentProgressValue(1, 3)).toBe(33)
    expect(getSessionAttachmentProgressValue(2, 3)).toBe(67)
  })

  it('clamps to 0..100', () => {
    expect(getSessionAttachmentProgressValue(20, 10)).toBe(100)
    expect(getSessionAttachmentProgressValue(0, 10)).toBe(0)
  })
})

describe('getSessionAttachmentStageLabel', () => {
  it('maps each known stage', () => {
    expect(getSessionAttachmentStageLabel('queued', t)).toBe('Queued')
    expect(getSessionAttachmentStageLabel('chunking', t)).toBe('Preparing')
    expect(getSessionAttachmentStageLabel('embedding', t)).toBe('Indexing')
    expect(getSessionAttachmentStageLabel('finalizing', t)).toBe('Finishing')
    expect(getSessionAttachmentStageLabel('ready', t)).toBe('Indexed')
  })

  it('falls back to a generic label for undefined', () => {
    expect(getSessionAttachmentStageLabel(undefined, t)).toBe('Indexing')
  })
})

describe('mergeSessionAttachmentStatesIntoFiles', () => {
  it('returns the input unchanged when either list is empty', () => {
    const files = [pf({ sessionAttachmentId: 1 })]
    expect(mergeSessionAttachmentStatesIntoFiles(files, [])).toEqual({ files, changed: false })
    expect(mergeSessionAttachmentStatesIntoFiles([], [attachment()])).toEqual({ files: [], changed: false })
  })

  it('leaves files without a session-attachment id or without a matching attachment untouched', () => {
    const noId = pf()
    const unmatched = pf({ sessionAttachmentId: 99 })
    const result = mergeSessionAttachmentStatesIntoFiles([noId, unmatched], [attachment({ id: 1 })])
    expect(result.changed).toBe(false)
    expect(result.files[0]).toBe(noId)
    expect(result.files[1]).toBe(unmatched)
  })

  it('folds new attachment state in and flags the change', () => {
    const file = pf({ sessionAttachmentId: 1, sessionAttachmentIndexStatus: 'pending' })
    const result = mergeSessionAttachmentStatesIntoFiles(
      [file],
      [attachment({ id: 1, indexStatus: 'ready', totalChunks: 4, embeddedChunks: 4 })]
    )
    expect(result.changed).toBe(true)
    expect(result.files[0]).not.toBe(file)
    expect(result.files[0].sessionAttachmentIndexStatus).toBe('ready')
    expect(result.files[0].sessionAttachmentEmbeddedChunks).toBe(4)
  })

  it('preserves object identity when nothing changed', () => {
    const file = pf({
      sessionAttachmentId: 1,
      sessionAttachmentIndexStatus: 'ready',
      sessionAttachmentAvailability: 'allowed',
    })
    const result = mergeSessionAttachmentStatesIntoFiles([file], [attachment({ id: 1, indexStatus: 'ready' })])
    expect(result.changed).toBe(false)
    expect(result.files[0]).toBe(file)
  })
})

describe('deriveAttachmentCardState', () => {
  const empty = {
    indexStatusMap: new Map(),
    errorMap: new Map(),
    progressMap: new Map<number, AttachmentProgressInfo>(),
    t,
  }

  it('maps a plain (non-RAG) processing file to a "Preparing" card', () => {
    const state = deriveAttachmentCardState({
      ...empty,
      fileStatus: 'processing',
      preprocessedFile: pf(),
    })
    expect(state.cardStatus).toBe('processing')
    expect(state.statusText).toBe('Preparing')
    expect(state.errorMessage).toBeUndefined()
  })

  it('reports an error card when the live error map has an entry', () => {
    const state = deriveAttachmentCardState({
      ...empty,
      fileStatus: 'completed',
      preprocessedFile: pf({ sessionAttachmentId: 7, ragMode: 'session-retrieval' }),
      errorMap: new Map([[7, 'boom']]),
    })
    expect(state.cardStatus).toBe('error')
    expect(state.errorMessage).toBe('boom')
  })

  it('shows a stage + percent label for an indexing session-retrieval file', () => {
    const state = deriveAttachmentCardState({
      ...empty,
      fileStatus: 'completed',
      preprocessedFile: pf({ sessionAttachmentId: 3, ragMode: 'session-retrieval' }),
      indexStatusMap: new Map([[3, 'indexing']]),
      progressMap: new Map([[3, { totalChunks: 4, embeddedChunks: 2, indexingStage: 'embedding' }]]),
    })
    expect(state.cardStatus).toBe('processing')
    expect(state.progressValue).toBe(50)
    expect(state.statusText).toBe('Indexing · 50%')
  })

  it('marks a ready session-retrieval file as completed with no status text', () => {
    const state = deriveAttachmentCardState({
      ...empty,
      fileStatus: 'completed',
      preprocessedFile: pf({ sessionAttachmentId: 4, ragMode: 'session-retrieval' }),
      indexStatusMap: new Map([[4, 'ready']]),
    })
    expect(state.cardStatus).toBe('completed')
    expect(state.statusText).toBeUndefined()
  })

  it('still shows "Preparing" for a ready RAG file whose raw file status is processing', () => {
    // Faithful to the original: the "Preparing" fallback keys off the raw file
    // status, not the index status, so a ready file mid-preprocess still reads it.
    const state = deriveAttachmentCardState({
      ...empty,
      fileStatus: 'processing',
      preprocessedFile: pf({ sessionAttachmentId: 4, ragMode: 'session-retrieval' }),
      indexStatusMap: new Map([[4, 'ready']]),
    })
    expect(state.cardStatus).toBe('completed')
    expect(state.statusText).toBe('Preparing')
  })

  it('reads "Still indexing" once processing exceeds 30s', () => {
    const startedAt = 1_000_000
    const state = deriveAttachmentCardState({
      ...empty,
      fileStatus: 'completed',
      preprocessedFile: pf({ sessionAttachmentId: 5, ragMode: 'session-retrieval' }),
      indexStatusMap: new Map([[5, 'indexing']]),
      progressMap: new Map([[5, { totalChunks: 4, embeddedChunks: 1, processingStartedAt: startedAt }]]),
      now: startedAt + 31_000,
    })
    expect(state.isTakingLong).toBe(true)
    expect(state.statusText).toBe('Still indexing · 25%')
  })
})
