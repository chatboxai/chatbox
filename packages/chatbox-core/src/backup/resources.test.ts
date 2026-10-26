import { buildContext } from '@shared/context'
import type { MessageFile, Session } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  collectSessionResourceReferences,
  prepareMessageForBackup,
  rehydrateSessionAttachmentsAsInline,
  restoreSessionResourceKeys,
} from './resources'

function retrievalFile(id: string): MessageFile {
  return {
    id,
    name: `${id}.txt`,
    fileType: 'text/plain',
    parserType: 'plain-text',
    storageKey: `file:${id}`,
    rawStorageKey: `file:${id}:raw`,
    localPath: `/desktop/${id}.txt`,
    ragMode: 'session-retrieval',
    sessionAttachmentId: 17,
    sessionAttachmentAvailability: 'allowed',
    sessionAttachmentIndexStatus: 'ready',
    sessionAttachmentStatus: 'ready',
    sessionAttachmentChunkCount: 3,
    sessionAttachmentTotalChunks: 3,
    sessionAttachmentEmbeddedChunks: 3,
    sessionAttachmentIndexingStage: 'ready',
    tokenCountMap: { default: 12 },
  }
}

describe('rehydrateSessionAttachmentsAsInline', () => {
  it('downgrades indexed attachments across the complete session graph without changing inline files', async () => {
    const inlineFile: MessageFile = {
      id: 'inline',
      name: 'inline.txt',
      fileType: 'text/plain',
      parserType: 'plain-text',
      storageKey: 'file:inline',
      ragMode: 'inline',
      tokenCountMap: { default: 5 },
    }
    const session: Session = {
      id: 'session',
      name: 'Session',
      messages: [
        {
          id: 'current',
          role: 'user',
          contentParts: [{ type: 'text', text: 'Current' }],
          files: [retrievalFile('current'), inlineFile],
        },
      ],
      threads: [
        {
          id: 'thread',
          name: 'History',
          createdAt: 1,
          messages: [
            {
              id: 'history',
              role: 'user',
              contentParts: [{ type: 'text', text: 'History' }],
              files: [retrievalFile('history')],
            },
          ],
        },
      ],
      messageForksHash: {
        current: {
          createdAt: 1,
          position: 0,
          lists: [
            {
              id: 'fork',
              messages: [
                {
                  id: 'fork-message',
                  role: 'user',
                  contentParts: [{ type: 'text', text: 'Fork' }],
                  files: [retrievalFile('fork')],
                },
              ],
            },
          ],
        },
      },
    }

    const rehydrated = rehydrateSessionAttachmentsAsInline(session)
    const files = [
      rehydrated.messages[0]?.files?.[0],
      rehydrated.threads?.[0]?.messages[0]?.files?.[0],
      rehydrated.messageForksHash?.current?.lists[0]?.messages[0]?.files?.[0],
    ]

    for (const file of files) {
      expect(file).toMatchObject({
        parserType: 'plain-text',
        ragMode: 'inline',
        rawStorageKey: expect.any(String),
        storageKey: expect.any(String),
        tokenCountMap: { default: 12 },
      })
      expect(file).not.toHaveProperty('sessionAttachmentId')
      expect(file).not.toHaveProperty('localPath')
      expect(file).not.toHaveProperty('sessionAttachmentIndexStatus')
      expect(file).not.toHaveProperty('sessionAttachmentStatus')
      expect(file).not.toHaveProperty('sessionAttachmentChunkCount')
      expect(file).not.toHaveProperty('sessionAttachmentTotalChunks')
      expect(file).not.toHaveProperty('sessionAttachmentEmbeddedChunks')
      expect(file).not.toHaveProperty('sessionAttachmentIndexingStage')
    }
    expect(rehydrated.messages[0]?.files?.[1]).toEqual(inlineFile)
    expect(session.messages[0]?.files?.[0]?.ragMode).toBe('session-retrieval')
    expect(session.messages[0]?.files?.[0]?.sessionAttachmentIndexStatus).toBe('ready')

    const bodies = new Map([
      ['file:current', 'indexed attachment body'],
      ['file:inline', 'existing inline body'],
    ])
    const context = await buildContext(rehydrated.messages, {
      attachmentResolver: { read: (key) => Promise.resolve(bodies.get(key) ?? null) },
      modelSupportToolUseForFile: false,
    })
    expect(JSON.stringify(context)).toContain('indexed attachment body')
    expect(JSON.stringify(context)).toContain('existing inline body')
  })
})

describe('compaction summary attachments', () => {
  const summary = {
    id: 'summary',
    role: 'assistant' as const,
    isSummary: true,
    contentParts: [{ type: 'text' as const, text: 'Summary' }],
    compactedFiles: [retrievalFile('covered')],
    compactedLinks: [{ id: 'link', url: 'https://example.com', title: 'Example', storageKey: 'link:covered' }],
  }

  it('leaves local paths and index state out of the backup', () => {
    const [file] = prepareMessageForBackup(summary).compactedFiles ?? []
    expect(file.localPath).toBeUndefined()
    expect(file.sessionAttachmentId).toBeUndefined()
  })

  it('backs up the resources a summary references after its covered messages are gone', () => {
    const session: Session = { id: 'session', name: 'Session', messages: [summary] }
    const { references, warnings } = collectSessionResourceReferences(session)
    expect(references.map((reference) => reference.storageKey)).toEqual(
      expect.arrayContaining(['file:covered', 'file:covered:raw', 'link:covered'])
    )
    expect(warnings).toEqual([])
  })

  it('follows restored resource keys and drops references to resources the backup lacks', () => {
    const session: Session = { id: 'session', name: 'Session', messages: [summary] }
    const restored = restoreSessionResourceKeys(
      session,
      new Map([
        ['file:covered', 'file:restored'],
        ['link:covered', 'link:restored'],
      ])
    ).messages[0]

    // Only covered messages rebuild their retrieval index; the summary keeps a plain file reference.
    expect(restored.compactedFiles?.[0]).toMatchObject({ storageKey: 'file:restored', ragMode: 'inline' })
    expect(restored.compactedFiles?.[0].rawStorageKey).toBeUndefined()
    expect(restored.compactedFiles?.[0].sessionAttachmentId).toBeUndefined()
    expect(restored.compactedLinks?.[0].storageKey).toBe('link:restored')
  })
})
