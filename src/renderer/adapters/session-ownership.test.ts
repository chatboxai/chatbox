import { expect, it } from 'vitest'
import { jsonUtf8Blocks, type BackupRow, type BackupSessionStore } from '@chatbox/core/backup'
import { contextSnapshot } from '../../../packages/chatbox-core/src/persistence/session-context-read.test-support'
import { collectSessionOwnership } from './session-ownership'

function source(fail = false): BackupSessionStore {
  const snapshot = contextSnapshot({
    id: 's',
    name: 'Ownership',
    messages: [{ id: 'active', role: 'user', contentParts: [] }],
    threads: [{ id: 'old', name: 'Old', createdAt: 1, messages: [{ id: 'archived', role: 'user', contentParts: [] }] }],
    messageForksHash: {
      active: {
        position: 1,
        createdAt: 1,
        lists: [
          { id: 'fork', messages: [{ id: 'branch', role: 'assistant', contentParts: [] }] },
          { id: 'selected', messages: [] },
        ],
      },
    },
  })
  return {
    listSessionIds: async () => ['s'],
    beginBackupRestore: async () => {
      throw new Error('Unexpected write')
    },
    async *iterateBackupRows(): AsyncGenerator<BackupRow> {
      yield { kind: 'header', record: snapshot.record }
      for (const row of snapshot.rows.messages) {
        const message = {
          ...row.message,
          files: [{ id: 'file-id', name: 'file', fileType: 'text/plain', sessionAttachmentId: 7 }],
          contentParts: [{ type: 'text' as const, text: 'x'.repeat(1024 * 1024) }],
        }
        yield {
          kind: 'message',
          message: row,
          payload: {
            chunks: async function* () {
              yield* jsonUtf8Blocks(message)
            },
          },
        }
      }
      if (fail) throw new Error('Source revision changed')
    },
  }
}
it('collects active, archived and fork ownership without retaining streamed bodies', async () => {
  const result = await collectSessionOwnership(source(), 's')
  expect(result.messageIds.sort()).toEqual(['active', 'archived', 'branch'])
  expect(result.attachmentReferences).toHaveLength(1)
  expect(result.attachmentReferences[0]).toMatchObject({ attachmentId: 7, sessionId: 's' })
  expect(JSON.stringify(result).length).toBeLessThan(300)
})
it('rejects a partial scan instead of returning incomplete ownership', async () => {
  await expect(collectSessionOwnership(source(true), 's')).rejects.toThrow('Source revision changed')
})

it('rejects an ownership ID that could have been truncated by a legacy projection', async () => {
  const original = source()
  const projected: BackupSessionStore = {
    ...original,
    async *iterateBackupRows(id, limits) {
      for await (const row of original.iterateBackupRows(id, limits)) {
        if (row.kind !== 'message') {
          yield row
          continue
        }
        const message = { ...row.message.message, id: 'x'.repeat(4097) }
        yield {
          ...row,
          message: { ...row.message, messageId: message.id.slice(0, 4096) },
          payload: {
            chunks: async function* () {
              yield* jsonUtf8Blocks(message)
            },
          },
        }
      }
    },
  }
  await expect(collectSessionOwnership(projected, 's')).rejects.toThrow('exceeds projection budget')
})
