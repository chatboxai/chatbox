import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message, MessageFile } from '../types'
import { contextPathFacts } from './context-path-facts'

const { relPath } = vi.hoisted(() => ({ relPath: vi.fn() }))
vi.mock('@shared/sandbox/attachment-path', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/sandbox/attachment-path')>()),
  sandboxAttachmentRelPath: relPath,
}))

const file = (index: number): MessageFile => ({
  id: `file-${index}`,
  name: `file-${index}.txt`,
  fileType: 'text/plain',
  storageKey: `parsed-${index}`,
})

describe('contextPathFacts seeds', () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('@shared/sandbox/attachment-path')>(
      '@shared/sandbox/attachment-path'
    )
    relPath.mockReset().mockImplementation(actual.sandboxAttachmentRelPath)
  })

  it('fingerprints each seed once across a long path and keeps the first of each destination', () => {
    const history: Message[] = Array.from({ length: 300 }, (_, index) => [
      { id: `user-${index}`, role: 'user' as const, contentParts: [], files: [file(index)] },
      { id: `reply-${index}`, role: 'assistant' as const, contentParts: [] },
    ]).flat()
    const summary: Message = {
      id: 'summary',
      role: 'assistant',
      isSummary: true,
      contentParts: [],
      compactedFiles: [file(0), file(1)],
    }

    const facts = contextPathFacts([...history, summary])

    expect(facts.sandboxSeedAttachments).toHaveLength(300)
    expect(relPath).toHaveBeenCalledTimes(302)
  })

  it('continues the destination set of an earlier part of the path', () => {
    const prefix = contextPathFacts([{ id: 'user', role: 'user', contentParts: [], files: [file(0)] }])
    relPath.mockClear()

    const facts = contextPathFacts(
      [{ id: 'summary', role: 'assistant', isSummary: true, contentParts: [], compactedFiles: [file(0), file(1)] }],
      prefix
    )

    expect(facts.sandboxSeedAttachments.map((seed) => seed.storageKey)).toEqual(['parsed-0', 'parsed-1'])
    expect(prefix.sandboxSeedAttachments).toHaveLength(1)
    expect(relPath).toHaveBeenCalledTimes(3)
  })
})
