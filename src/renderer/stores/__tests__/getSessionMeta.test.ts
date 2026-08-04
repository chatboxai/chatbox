// @vitest-environment jsdom

import type { Session } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { getSessionMeta } from '../sessionHelpers'

function makeSession(overrides: Partial<Session> & { id: string }): Session {
  return {
    name: 'Chat',
    messages: [],
    ...overrides,
  }
}

describe('getSessionMeta', () => {
  it('preserves parentId (regression: chats must persist folder nesting)', () => {
    const session = makeSession({ id: 's1', parentId: 'folder-1' })
    const meta = getSessionMeta(session)
    expect(meta.parentId).toBe('folder-1')
  })

  it('omits parentId when the session has none (top-level chat)', () => {
    const session = makeSession({ id: 's1' })
    const meta = getSessionMeta(session)
    expect(meta.parentId).toBeUndefined()
  })

  it('still carries the core fields (id, name, starred, type)', () => {
    const session = makeSession({ id: 's1', name: 'My chat', starred: true, type: 'chat' })
    const meta = getSessionMeta(session)
    expect(meta).toMatchObject({ id: 's1', name: 'My chat', starred: true, type: 'chat' })
  })

  it('does not leak message data fields', () => {
    const session = makeSession({ id: 's1' })
    const meta = getSessionMeta(session as never)
    expect(meta).not.toHaveProperty('messages')
    expect(meta).not.toHaveProperty('threads')
  })
})