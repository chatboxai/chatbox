import { describe, expect, test } from 'vitest'
import type { Message } from '../../types/session'
import {
  applySessionMessageDerivedPatch,
  getSessionMessageTokenizationDigest,
  getSessionMessageTokenizationText,
  getTokenizationTextDigest,
  type SessionAttachmentDerivedPatch,
  type SessionMessageDerivedPatch,
  type SessionMessageTextDerivedPatch,
} from './message-derived-data'

function message(): Message {
  return {
    id: 'message-1',
    role: 'assistant',
    contentParts: [{ type: 'text', text: 'hello' }],
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 80 },
    tokenCount: 20,
    tokensUsed: 120,
    tokenCountMap: { deepseek: 3, historical: 7 },
    tokenCalculatedAt: { deepseek: 10 },
    tokenCountApproximate: { deepseek: true },
    timestamp: 1,
    updatedAt: 2,
    generating: true,
    isSummary: true,
    steered: true,
    files: [
      {
        id: 'attachment-1',
        name: 'notes.txt',
        storageKey: 'file:one',
        rawStorageKey: 'file:raw',
        fileType: 'text/plain',
        tokenCountMap: { deepseek_preview: 4, historical: 9 },
        tokenCalculatedAt: { deepseek_preview: 12 },
        lineCount: 2,
        byteLength: 20,
      },
      { id: 'attachment-2', name: 'other.txt', storageKey: 'file:two', fileType: 'text/plain' },
    ],
    links: [{ id: 'attachment-1', title: 'Website', url: 'https://example.com', storageKey: 'link:one' }],
  }
}

function textPatch(
  source: Message,
  overrides: Partial<SessionMessageTextDerivedPatch> = {}
): SessionMessageTextDerivedPatch {
  return {
    tokenizerType: 'default',
    sourceDigest: getSessionMessageTokenizationDigest(source),
    tokens: 5,
    calculatedAt: 100,
    ...overrides,
  }
}

function filePatch(overrides: Partial<SessionAttachmentDerivedPatch> = {}): SessionAttachmentDerivedPatch {
  return {
    id: 'attachment-1',
    type: 'file',
    sourceStorageKey: 'file:one',
    sourceName: 'notes.txt',
    tokenCountMap: { default: 11, default_preview: 8 },
    tokenCalculatedAt: { default: 100, default_preview: 100 },
    metadataCalculatedAt: 100,
    lineCount: 5,
    byteLength: 50,
    ...overrides,
  }
}

describe('message tokenization source', () => {
  test('matches the worker text projection, including reasoning and image placeholders', () => {
    const source: Message = {
      ...message(),
      contentParts: [
        { type: 'text', text: 'hello' },
        { type: 'reasoning', text: 'considering' },
        { type: 'image', storageKey: 'image:one' },
      ],
    }
    expect(getSessionMessageTokenizationText(source)).toBe('hello\nconsidering\n[image]')
    expect(getSessionMessageTokenizationDigest(source)).toBe(getTokenizationTextDigest('hello\nconsidering\n[image]'))
    expect(getTokenizationTextDigest('hello')).toBe('5:m3bicr')
  })
})

describe('applySessionMessageDerivedPatch', () => {
  test('merges tokenizer caches without changing provider usage, message state or source data', () => {
    const source = message()
    const before = structuredClone(source)
    const incoming = {
      messageId: source.id,
      text: [textPatch(source, { approximate: true })],
      role: 'user',
      contentParts: [],
      usage: { totalTokens: 0 },
      generating: false,
      updatedAt: 999,
    }
    const result = applySessionMessageDerivedPatch(source, incoming)
    expect(result?.message).toEqual({
      ...source,
      tokenCountMap: { deepseek: 3, historical: 7, default: 5 },
      tokenCalculatedAt: { deepseek: 10, default: 100 },
      tokenCountApproximate: { deepseek: true, default: true },
    })
    expect(result?.message.contentParts).toBe(source.contentParts)
    expect(result?.message.usage).toBe(source.usage)
    expect(result?.message.files).toBe(source.files)
    expect(source).toEqual(before)
    expect(Object.keys(result?.patch ?? {}).sort()).toEqual(['messageId', 'text'])
  })

  test('an exact result clears only its tokenizer approximation marker', () => {
    const source = message()
    const result = applySessionMessageDerivedPatch(source, {
      messageId: source.id,
      text: [textPatch(source, { tokenizerType: 'deepseek', tokens: 4 })],
    })
    expect(result?.message.tokenCountApproximate).toBeUndefined()
    expect(result?.message.tokenCountMap).toEqual({ deepseek: 4, historical: 7 })
  })

  test('rejects results for another message, changed text or an older calculation', () => {
    const source = message()
    const patch = { messageId: source.id, text: [textPatch(source)] }
    expect(applySessionMessageDerivedPatch({ ...source, id: 'other' }, patch)).toBeNull()
    expect(
      applySessionMessageDerivedPatch({ ...source, contentParts: [{ type: 'text', text: 'edited' }] }, patch)
    ).toBeNull()
    expect(
      applySessionMessageDerivedPatch(
        { ...source, tokenCountMap: { default: 10 }, tokenCalculatedAt: { default: 101 } },
        patch
      )
    ).toBeNull()
  })

  test('an empty or already applied patch is a no-op', () => {
    const source = message()
    expect(applySessionMessageDerivedPatch(source, { messageId: source.id })).toBeNull()
    const result = applySessionMessageDerivedPatch(source, {
      messageId: source.id,
      text: [textPatch(source)],
      attachments: [filePatch()],
    })
    if (!result) throw new Error('expected a derived update')
    expect(applySessionMessageDerivedPatch(result.message, result.patch)).toBeNull()
  })

  test('merges only allowed attachment fields and keeps file and link identities separate', () => {
    const source = message()
    const before = structuredClone(source)
    const incoming = {
      ...filePatch(),
      name: 'replacement.txt',
      storageKey: 'replacement',
      rawStorageKey: 'replacement:raw',
      tokenCountMap: { default: 11, default_preview: 8, unexpected: 999 },
      tokenCalculatedAt: { default: 100, default_preview: 100, unexpected: 999 },
    }
    const result = applySessionMessageDerivedPatch(source, { messageId: source.id, attachments: [incoming] })
    expect(result?.message.files?.[0]).toEqual({
      ...source.files?.[0],
      tokenCountMap: { deepseek_preview: 4, historical: 9, default: 11, default_preview: 8 },
      tokenCalculatedAt: { deepseek_preview: 12, default: 100, default_preview: 100 },
      lineCount: 5,
      byteLength: 50,
    })
    expect(result?.message.files?.[1]).toBe(source.files?.[1])
    expect(result?.message.links).toBe(source.links)
    expect(result?.message.usage).toBe(source.usage)
    expect(result?.patch.attachments?.[0]).toEqual(filePatch())
    expect(source).toEqual(before)
  })

  test.each([
    { id: 'missing' },
    { sourceStorageKey: 'file:replaced' },
    { sourceStorageKey: '' },
    { sourceName: 'renamed.txt' },
    { type: 'link' as const },
  ])('rejects an attachment whose source no longer matches: %o', (overrides) => {
    const source = message()
    expect(
      applySessionMessageDerivedPatch(source, { messageId: source.id, attachments: [filePatch(overrides)] })
    ).toBeNull()
  })

  test('updates links by their title and preserves their URL', () => {
    const source = message()
    const result = applySessionMessageDerivedPatch(source, {
      messageId: source.id,
      attachments: [filePatch({ type: 'link', sourceStorageKey: 'link:one', sourceName: 'Website' })],
    })
    expect(result?.message.files).toBe(source.files)
    expect(result?.message.links?.[0]).toEqual({
      ...source.links?.[0],
      tokenCountMap: { default: 11, default_preview: 8 },
      tokenCalculatedAt: { default: 100, default_preview: 100 },
      lineCount: 5,
      byteLength: 50,
    })
  })

  test('retains only accepted entries when text and attachment results arrive together', () => {
    const source = message()
    const patch: SessionMessageDerivedPatch = {
      messageId: source.id,
      text: [textPatch(source, { sourceDigest: 'stale' }), textPatch(source, { tokenizerType: 'deepseek' })],
      attachments: [filePatch({ id: 'missing' }), filePatch()],
    }
    const result = applySessionMessageDerivedPatch(source, patch)
    expect(result?.patch.text).toEqual([{ ...patch.text?.[1], approximate: false }])
    expect(result?.patch.attachments).toEqual([filePatch()])
    expect(result?.message.tokenCountMap?.default).toBeUndefined()
  })

  test('returns complete accepted cache entries so replay can repair an older cached copy', () => {
    const source = message()
    const persisted: Message = {
      ...source,
      files: source.files?.map((file, index) =>
        index === 0
          ? {
              ...file,
              tokenCountMap: { default: 11 },
              tokenCalculatedAt: { default: 100 },
              lineCount: 5,
              byteLength: 50,
            }
          : file
      ),
    }
    const result = applySessionMessageDerivedPatch(persisted, {
      messageId: source.id,
      attachments: [
        filePatch({ tokenCountMap: { default: 11 }, tokenCalculatedAt: { default: 101 }, metadataCalculatedAt: 101 }),
      ],
    })
    if (!result) throw new Error('expected a derived update')
    const replayed = applySessionMessageDerivedPatch(source, result.patch)
    expect(replayed?.message.files?.[0].tokenCountMap?.default).toBe(11)
    expect(replayed?.message.files?.[0].tokenCalculatedAt?.default).toBe(101)
    expect(replayed?.message.files?.[0].lineCount).toBe(5)
    expect(replayed?.message.files?.[0].byteLength).toBe(50)
    expect(
      applySessionMessageDerivedPatch(
        { ...source, files: source.files?.map((file) => ({ ...file, storageKey: 'changed' })) },
        result.patch
      )
    ).toBeNull()
  })

  test('ignores an older attachment tokenizer result while applying a newer key', () => {
    const source = message()
    const result = applySessionMessageDerivedPatch(source, {
      messageId: source.id,
      attachments: [
        filePatch({
          tokenCountMap: { deepseek_preview: 99, default: 11 },
          tokenCalculatedAt: { deepseek_preview: 11, default: 100 },
        }),
      ],
    })
    expect(result?.message.files?.[0].tokenCountMap).toEqual({ deepseek_preview: 4, historical: 9, default: 11 })
    expect(result?.patch.attachments?.[0].tokenCountMap).toEqual({ default: 11 })
    expect(result?.patch.attachments?.[0].tokenCalculatedAt).toEqual({ default: 100 })
  })

  test('an older attachment read failure cannot replace newer dimensions with zeroes', () => {
    const source = message()
    const current: Message = {
      ...source,
      files: source.files?.map((file, index) =>
        index === 0
          ? {
              ...file,
              tokenCountMap: { default: 11 },
              tokenCalculatedAt: { default: 100 },
              lineCount: 5,
              byteLength: 50,
            }
          : file
      ),
    }
    expect(
      applySessionMessageDerivedPatch(current, {
        messageId: source.id,
        attachments: [
          filePatch({
            tokenCountMap: { default: 0 },
            tokenCalculatedAt: { default: 90 },
            metadataCalculatedAt: 90,
            lineCount: 0,
            byteLength: 0,
          }),
        ],
      })
    ).toBeNull()
  })

  test('dimension clock survives replay against a newer cache from another tokenizer', () => {
    const source = message()
    const accepted = applySessionMessageDerivedPatch(source, {
      messageId: source.id,
      attachments: [filePatch()],
    })
    if (!accepted) throw new Error('expected a derived update')
    expect(accepted.patch.attachments?.[0].metadataCalculatedAt).toBe(100)
    const cached: Message = {
      ...source,
      files: source.files?.map((file, index) =>
        index === 0
          ? {
              ...file,
              tokenCountMap: { deepseek: 17 },
              tokenCalculatedAt: { deepseek: 110 },
              lineCount: 7,
              byteLength: 70,
            }
          : file
      ),
    }
    const replayed = applySessionMessageDerivedPatch(cached, accepted.patch)
    expect(replayed?.message.files?.[0].tokenCountMap?.default).toBe(11)
    expect(replayed?.message.files?.[0].lineCount).toBe(7)
    expect(replayed?.message.files?.[0].byteLength).toBe(70)
    expect(replayed?.patch.attachments?.[0].lineCount).toBeUndefined()
    expect(replayed?.patch.attachments?.[0].metadataCalculatedAt).toBeUndefined()
  })

  test.each([undefined, 110])(
    'newer merged token results do not authorize older dimensions: current %s',
    (calculatedAt) => {
      const source = message()
      const current: Message = {
        ...source,
        files: source.files?.map((file, index) =>
          index === 0
            ? {
                ...file,
                tokenCalculatedAt: calculatedAt === undefined ? undefined : { deepseek: calculatedAt },
                lineCount: 7,
                byteLength: 70,
              }
            : file
        ),
      }
      const result = applySessionMessageDerivedPatch(current, {
        messageId: source.id,
        attachments: [
          filePatch({
            tokenCountMap: { default: 20, default_preview: 0 },
            tokenCalculatedAt: { default: 120, default_preview: 90 },
            metadataCalculatedAt: 90,
            lineCount: 0,
            byteLength: 0,
          }),
        ],
      })
      expect(result?.message.files?.[0].tokenCountMap?.default).toBe(20)
      expect(result?.message.files?.[0].lineCount).toBe(7)
      expect(result?.message.files?.[0].byteLength).toBe(70)
    }
  )

  test.each([undefined, 200])(
    'dimensions need an accepted calculation at their own time: %s',
    (metadataCalculatedAt) => {
      const source = message()
      const result = applySessionMessageDerivedPatch(source, {
        messageId: source.id,
        attachments: [filePatch({ metadataCalculatedAt })],
      })
      expect(result?.message.files?.[0].tokenCountMap?.default).toBe(11)
      expect(result?.message.files?.[0].lineCount).toBe(2)
      expect(result?.message.files?.[0].byteLength).toBe(20)
      expect(result?.patch.attachments?.[0].metadataCalculatedAt).toBeUndefined()
    }
  )
})
