import type { CopilotDetail, Session, SessionMetaRecord, Settings } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  collectSessionResourceReferences,
  prepareSessionForBackup,
  restoreCopilotResourceKeys,
  restoreSessionMetaResourceKeys,
  restoreSessionResourceKeys,
  restoreSettingsResourceKeys,
} from './resources'

function createSession(): Session {
  return {
    id: 'session-1',
    name: 'Backup test',
    messages: [
      {
        id: 'message-1',
        role: 'user',
        contentParts: [
          { type: 'text', text: 'hello' },
          { type: 'image', storageKey: 'picture:shared' },
        ],
        files: [
          {
            id: 'file-1',
            name: 'report.pdf',
            fileType: 'application/pdf',
            storageKey: 'file:parsed',
            rawStorageKey: 'file:raw',
            ragMode: 'session-retrieval',
            sessionAttachmentId: 42,
            sessionAttachmentAvailability: 'allowed',
            sessionAttachmentIndexStatus: 'ready',
            sessionAttachmentChunkCount: 2,
            localPath: '/Users/example/report.pdf',
          },
        ],
        links: [{ id: 'link-1', url: 'https://example.com', title: 'Example', storageKey: 'link:parsed' }],
      },
    ],
    threads: [
      {
        id: 'thread-1',
        name: 'Earlier',
        createdAt: 1,
        messages: [
          {
            id: 'message-2',
            role: 'assistant',
            contentParts: [
              {
                type: 'tool-call',
                state: 'result',
                toolCallId: 'tool-1',
                toolName: 'search',
                resultStorageKey: 'tool:result',
                resultImageStorageKey: 'picture:tool-image',
                resultImageMediaType: 'image/webp',
                result: { file_path: 'chart.webp', media_type: 'image/webp' },
              },
            ],
          },
        ],
      },
    ],
    assistantAvatarKey: 'picture:avatar',
    backgroundImage: { type: 'storage-key', storageKey: 'picture:background' },
  }
}

describe('backup resource graph', () => {
  it('collects managed resources from messages, threads, attachments, and session decoration', () => {
    const collected = collectSessionResourceReferences(createSession())
    expect(new Set(collected.references.map((reference) => reference.storageKey))).toEqual(
      new Set([
        'picture:shared',
        'file:parsed',
        'file:raw',
        'link:parsed',
        'tool:result',
        'picture:tool-image',
        'picture:avatar',
        'picture:background',
      ])
    )
  })

  it('does not warn when a text attachment is included through its parsed text', () => {
    const session = createSession()
    session.messages[0].files = [
      {
        id: 'text-file',
        name: 'notes.txt',
        fileType: 'text/plain',
        storageKey: 'file:text',
        localPath: '/Users/example/notes.txt',
      },
    ]

    const collected = collectSessionResourceReferences(session)
    expect(collected.references).toContainEqual(
      expect.objectContaining({ storageKey: 'file:text', kind: 'parsed-attachment' })
    )
    expect(collected.warnings).toEqual([])
  })

  it('still warns when a text attachment has no managed content to include', () => {
    const session = createSession()
    session.messages[0].files = [
      {
        id: 'missing-text-file',
        name: 'missing.txt',
        fileType: 'text/plain',
        localPath: '/Users/example/missing.txt',
      },
    ]

    expect(collectSessionResourceReferences(session).warnings).toContainEqual(
      expect.objectContaining({ code: 'external-resource-skipped', itemId: 'missing.txt' })
    )
  })

  it('still warns when only parsed text from a non-text attachment can be included', () => {
    const session = createSession()
    session.messages[0].files = [
      {
        id: 'external-pdf',
        name: 'report.pdf',
        fileType: 'application/pdf',
        storageKey: 'file:parsed',
        localPath: '/Users/example/report.pdf',
      },
    ]

    expect(collectSessionResourceReferences(session).warnings).toContainEqual(
      expect.objectContaining({ code: 'external-resource-skipped', itemId: 'report.pdf' })
    )
  })

  it('remaps every managed reference and clears non-portable RAG state', () => {
    const source = createSession()
    const remapped = restoreSessionResourceKeys(
      source,
      new Map([
        ['picture:shared', 'picture:restored'],
        ['file:parsed', 'file:parsed:restored'],
        ['file:raw', 'file:raw:restored'],
        ['link:parsed', 'link:restored'],
        ['tool:result', 'tool:restored'],
        ['picture:tool-image', 'picture:tool-image:restored'],
        ['picture:avatar', 'picture:avatar:restored'],
        ['picture:background', 'picture:background:restored'],
      ])
    )
    expect(remapped.messages[0].contentParts[1]).toMatchObject({ storageKey: 'picture:restored' })
    expect(remapped.messages[0].files?.[0]).toMatchObject({
      storageKey: 'file:parsed:restored',
      rawStorageKey: 'file:raw:restored',
    })
    expect(remapped.messages[0].files?.[0].sessionAttachmentId).toBeUndefined()
    expect(remapped.threads?.[0].messages[0].contentParts[0]).toMatchObject({
      resultStorageKey: 'tool:restored',
      resultImageStorageKey: 'picture:tool-image:restored',
      resultImageMediaType: 'image/webp',
    })
    expect(remapped.assistantAvatarKey).toBe('picture:avatar:restored')
    expect(source.messages[0].contentParts[1]).toMatchObject({ storageKey: 'picture:shared' })
    expect(source.messages[0].files?.[0].sessionAttachmentId).toBe(42)
  })

  it('removes missing managed resource keys without dropping recoverable message metadata', () => {
    const cleaned = restoreSessionResourceKeys(createSession(), new Map([['file:parsed', 'file:parsed']]))

    expect(cleaned.messages[0].contentParts).toEqual([{ type: 'text', text: 'hello' }])
    expect(cleaned.messages[0].files?.[0]).toMatchObject({ storageKey: 'file:parsed', name: 'report.pdf' })
    expect(cleaned.messages[0].files?.[0].rawStorageKey).toBeUndefined()
    expect(cleaned.messages[0].links?.[0]).toMatchObject({ url: 'https://example.com', title: 'Example' })
    expect(cleaned.messages[0].links?.[0].storageKey).toBeUndefined()
    expect(cleaned.threads?.[0].messages[0].contentParts[0]).not.toHaveProperty('resultStorageKey')
    expect(cleaned.threads?.[0].messages[0].contentParts[0]).not.toHaveProperty('resultImageStorageKey')
    expect(cleaned.assistantAvatarKey).toBeUndefined()
    expect(cleaned.backgroundImage).toBeUndefined()
  })

  it('remaps legacy image references still stored in tool result JSON', () => {
    const session = createSession()
    const toolPart = session.threads?.[0].messages[0].contentParts[0]
    if (!toolPart || toolPart.type !== 'tool-call') throw new Error('missing tool fixture')
    delete toolPart.resultImageStorageKey
    delete toolPart.resultImageMediaType
    toolPart.result = {
      file_path: 'legacy.png',
      image_storage_key: 'picture:legacy',
      media_type: 'image/png',
    }

    const restored = restoreSessionResourceKeys(session, new Map([['picture:legacy', 'picture:legacy:restored']]))
    expect(restored.threads?.[0].messages[0].contentParts[0]).toMatchObject({
      result: { image_storage_key: 'picture:legacy:restored' },
    })
  })

  it('keeps a legacy picture URL when its managed storage key is unavailable', () => {
    const session = createSession()
    const message = session.messages[0] as (typeof session.messages)[number] & {
      pictures?: Array<{ storageKey?: string; url?: string; loading?: boolean }>
    }
    message.pictures = [
      { storageKey: 'picture:missing', url: 'https://example.com/fallback.png' },
      { storageKey: 'picture:missing-only' },
      { loading: true },
      {},
    ]

    const cleaned = restoreSessionResourceKeys(session, new Map())
    const cleanedMessage = cleaned.messages[0] as (typeof cleaned.messages)[number] & {
      pictures?: Array<{ storageKey?: string; url?: string; loading?: boolean }>
    }
    expect(cleanedMessage.pictures).toEqual([{ url: 'https://example.com/fallback.png' }])
  })

  it('removes missing resource keys from metadata, settings, and copilots', () => {
    const resourceKeyMap = new Map([['picture:kept', 'picture:kept']])
    const meta: SessionMetaRecord = {
      id: 'session-1',
      name: 'Backup test',
      sortOrder: 1,
      createdAt: 1,
      assistantAvatarKey: 'picture:avatar',
      backgroundImage: { type: 'storage-key', storageKey: 'picture:background' },
    }
    const settings: Partial<Settings> = {
      userAvatarKey: 'picture:avatar',
      defaultAssistantAvatarKey: 'picture:kept',
      backgroundImageKey: 'picture:background',
    }
    const copilots: CopilotDetail[] = [
      {
        id: 'copilot-1',
        name: 'Copilot',
        prompt: 'Help',
        avatar: { type: 'storage-key', storageKey: 'picture:avatar' },
        backgroundImage: { type: 'url', url: 'https://example.com/background.png' },
        screenshots: [
          { type: 'storage-key', storageKey: 'picture:background' },
          { type: 'url', url: 'https://example.com/screenshot.png' },
        ],
      },
    ]

    expect(restoreSessionMetaResourceKeys(meta, resourceKeyMap)).not.toHaveProperty('assistantAvatarKey')
    expect(restoreSessionMetaResourceKeys(meta, resourceKeyMap)).not.toHaveProperty('backgroundImage')
    expect(restoreSettingsResourceKeys(settings, resourceKeyMap)).toEqual({
      defaultAssistantAvatarKey: 'picture:kept',
    })
    expect(restoreCopilotResourceKeys(copilots, resourceKeyMap)[0]).toMatchObject({
      avatar: undefined,
      backgroundImage: { type: 'url' },
      screenshots: [{ type: 'url', url: 'https://example.com/screenshot.png' }],
    })
  })

  it('removes local paths and derived RAG state from serialized sessions', () => {
    const prepared = prepareSessionForBackup(createSession())
    const file = prepared.messages[0].files?.[0]
    expect(file).toMatchObject({ ragMode: 'session-retrieval' })
    expect(file?.localPath).toBeUndefined()
    expect(file?.sessionAttachmentId).toBeUndefined()
    expect(file?.sessionAttachmentAvailability).toBeUndefined()
    expect(file?.sessionAttachmentIndexStatus).toBeUndefined()
    expect(file?.sessionAttachmentChunkCount).toBeUndefined()
  })
})
