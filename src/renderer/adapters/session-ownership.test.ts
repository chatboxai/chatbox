import { expect, it } from 'vitest'
import type { SessionAttachmentRepositoryPort } from '@chatbox/core/ports'
import { collectSessionOwnership } from './session-ownership'

function source(fail = false): SessionAttachmentRepositoryPort {
  return {
    async *iterateSessionAttachmentFacts(request) {
      expect(request).toEqual({ sessionId: 's', scope: 'session' })
      for (const messageId of ['active', 'archived', 'branch', 'x'.repeat(4097)])
        yield {
          sessionId: 's',
          threadId: 'thread',
          messageId,
          revision: 1,
          files: [],
          imageStorageKeys: [],
          attachmentOwnershipIds: [7],
        }
      if (fail) throw new Error('Source revision changed')
    },
  }
}

it('collects all path ownership from metadata and preserves complete message identities', async () => {
  const result = await collectSessionOwnership(source(), 's')
  expect(result.messageIds).toEqual(['active', 'archived', 'branch', 'x'.repeat(4097)])
  expect(result.attachmentReferences).toEqual([{ attachmentId: 7, sessionId: 's', messageId: 'active' }])
})

it('rejects a partial scan instead of authorizing cleanup with incomplete ownership', async () => {
  await expect(collectSessionOwnership(source(true), 's')).rejects.toThrow('Source revision changed')
})
