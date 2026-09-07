import { describe, expect, test, vi } from 'vitest'
import { AttachmentService, encodeBase64 } from './AttachmentService'
import type { AttachmentAnalysis, PickedAsset } from './attachment-types'

function createMemoryStorage() {
  const values = new Map<string, unknown>()
  return {
    values,
    get: <T>(key: string) => Promise.resolve((values.get(key) as T | undefined) ?? null),
    set: <T>(key: string, value: T) => {
      values.set(key, value)
      return Promise.resolve()
    },
  }
}

function asset(overrides: Partial<PickedAsset> = {}): PickedAsset {
  return {
    id: 'file:report.bin-3-10',
    uri: 'file:///report.bin',
    name: 'report.bin',
    mimeType: 'application/octet-stream',
    size: 3,
    lastModified: 10,
    ...overrides,
  }
}

const analysis: AttachmentAnalysis = {
  ragMode: 'inline',
  tokenCountMap: { default: 7, default_preview: 3 },
  lineCount: 2,
  byteLength: 12,
  sessionAttachmentAvailability: 'allowed',
}

describe('AttachmentService', () => {
  test('encodes binary bytes without DOM or Node globals', () => {
    expect(encodeBase64(Uint8Array.from([]))).toBe('')
    expect(encodeBase64(Uint8Array.from([0x66]))).toBe('Zg==')
    expect(encodeBase64(Uint8Array.from([0x66, 0x6f]))).toBe('Zm8=')
    expect(encodeBase64(Uint8Array.from([0x66, 0x6f, 0x6f]))).toBe('Zm9v')
  })

  test('persists parsed content, raw bytes and historical metadata keys', async () => {
    const blobs = createMemoryStorage()
    const metadata = createMemoryStorage()
    const parser = vi.fn(() =>
      Promise.resolve({ content: 'line 1\nline 2', parserType: 'local', tokenCountMap: { default: 5 } })
    )
    const analyze = vi.fn(() => Promise.resolve(analysis))
    const service = new AttachmentService({
      blobs,
      metadata,
      content: { readBytes: () => Promise.resolve(Uint8Array.from([0, 1, 2])) },
      parser: { parse: parser },
      analysis: { analyze },
    })

    const result = await service.prepare(asset())

    expect(result).toMatchObject({
      storageKey: 'file:report.bin-3-10',
      rawStorageKey: 'file:report.bin-3-10_raw',
      parserType: 'local',
      tokenCountMap: analysis.tokenCountMap,
    })
    expect(blobs.values.get('file:report.bin-3-10')).toBe('line 1\nline 2')
    expect(blobs.values.get('file:report.bin-3-10_raw')).toBe('data:application/octet-stream;base64,AAEC')
    expect(metadata.values.get('file:report.bin-3-10_tokenMap')).toEqual(analysis.tokenCountMap)
    expect(metadata.values.get('file:report.bin-3-10_parserType')).toBe('local')
  })

  test('reuses parsed cache and repairs a missing raw binary without invoking the parser', async () => {
    const blobs = createMemoryStorage()
    const metadata = createMemoryStorage()
    await blobs.set('file:report.bin-3-10', 'cached content')
    await metadata.set('file:report.bin-3-10_tokenMap', { default: 5 })
    await metadata.set('file:report.bin-3-10_parserType', 'chatbox-ai')
    const parser = vi.fn(() => Promise.reject(new Error('parser should not run')))
    const readBytes = vi.fn(() => Promise.resolve(Uint8Array.from([3, 4])))
    const service = new AttachmentService({
      blobs,
      metadata,
      content: { readBytes },
      parser: { parse: parser },
      analysis: { analyze: () => Promise.resolve(analysis) },
    })

    const result = await service.prepare(asset())

    expect(result.content).toBe('cached content')
    expect(result.parserType).toBe('chatbox-ai')
    expect(result.rawStorageKey).toBe('file:report.bin-3-10_raw')
    expect(parser).not.toHaveBeenCalled()
    expect(readBytes).toHaveBeenCalledOnce()
  })

  test('does not persist raw data for text assets and returns structured preparation errors', async () => {
    const blobs = createMemoryStorage()
    const metadata = createMemoryStorage()
    const readBytes = vi.fn(() => Promise.resolve(Uint8Array.from([1])))
    const service = new AttachmentService({
      blobs,
      metadata,
      content: { readBytes },
      parser: { parse: () => Promise.reject(new Error('local_parser_failed')) },
      analysis: { analyze: () => Promise.resolve(analysis) },
    })

    const result = await service.prepare(
      asset({
        id: 'file:notes.txt-4-10',
        name: 'notes.txt',
        mimeType: 'text/plain',
        size: 4,
      })
    )

    expect(result).toMatchObject({ content: '', storageKey: '', error: 'local_parser_failed' })
    expect(readBytes).not.toHaveBeenCalled()
    expect(blobs.values.has('file:notes.txt-4-10_raw')).toBe(false)
  })
})
