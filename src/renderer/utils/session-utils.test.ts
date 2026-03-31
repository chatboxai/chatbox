import { describe, expect, it } from 'vitest'
import { migrateSession } from './session-utils'

describe('migrateSession', () => {
  it('preserves forward-compatible structured parts across session, threads, and fork history', () => {
    const appPart = {
      type: 'app',
      appId: 'story-builder',
      appInstanceId: 'instance-1',
      state: 'complete',
    }

    const session = {
      id: 'session-1',
      name: 'ChatBridge',
      messages: [{ id: 'main-msg', role: 'assistant', content: 'legacy', contentParts: [appPart] }],
      threads: [
        {
          id: 'thread-1',
          name: 'Archived thread',
          createdAt: 1,
          messages: [{ id: 'thread-msg', role: 'assistant', content: 'legacy', contentParts: [appPart] }],
        },
      ],
      messageForksHash: {
        pivot: {
          position: 0,
          createdAt: 1,
          lists: [
            {
              id: 'fork-1',
              messages: [{ id: 'fork-msg', role: 'assistant', content: 'legacy', contentParts: [appPart] }],
            },
          ],
        },
      },
    } as never

    const migrated = migrateSession(session)

    expect(migrated.messages[0].contentParts[0]).toMatchObject({
      type: 'app',
      appId: 'story-builder',
      appInstanceId: 'instance-1',
      lifecycle: 'complete',
    })
    expect(migrated.threads?.[0].messages[0].contentParts[0]).toMatchObject({
      lifecycle: 'complete',
    })
    expect(migrated.messageForksHash?.pivot.lists[0].messages[0].contentParts[0]).toMatchObject({
      lifecycle: 'complete',
    })
  })
})
