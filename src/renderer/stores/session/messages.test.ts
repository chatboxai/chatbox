import type { Message, Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Unit tests for the message-level wrappers around chatStore. The heavy
// orchestration entry point (submitNewUserMessage) is covered by the
// orchestration/E2E suites; here we pin the counting/caching/persist and
// RAG-cleanup semantics of the small wrappers.

const mocks = vi.hoisted(() => ({
  getSession: vi.fn<(id: string) => Promise<Session | null>>(),
  insertMessage: vi.fn(() => Promise.resolve()),
  updateMessage: vi.fn(() => Promise.resolve()),
  updateMessageCache: vi.fn(() => Promise.resolve()),
  removeMessage: vi.fn(() => Promise.resolve()),
  deleteMessageAttachments: vi.fn(() => Promise.resolve()),
  estimateTokens: vi.fn(() => 7),
}))

vi.mock('../chatStore', () => ({
  getSession: mocks.getSession,
  getSessionSettings: vi.fn(() => Promise.resolve(null)),
  insertMessage: mocks.insertMessage,
  updateMessage: mocks.updateMessage,
  updateMessageCache: mocks.updateMessageCache,
  removeMessage: mocks.removeMessage,
}))

vi.mock('@/platform', () => ({
  default: {
    type: 'desktop',
    getSessionAttachmentRagController: () => ({ deleteMessageAttachments: mocks.deleteMessageAttachments }),
  },
}))

vi.mock('@/adapters', () => ({ createModel: vi.fn() }))
vi.mock('@/packages/context-management', () => ({ runCompactionWithUIState: vi.fn() }))
vi.mock('@/packages/model-setting-utils', () => ({ getModelDisplayName: vi.fn() }))
vi.mock('@/packages/token', () => ({ estimateTokensFromMessages: mocks.estimateTokens }))
vi.mock('../sessionAttachmentRagIndexing', () => ({ ensureMessageFileSessionAttachment: vi.fn() }))
vi.mock('../settingActions', () => ({}))
vi.mock('../settingsStore', () => ({ settingsStore: { getState: () => ({ getSettings: () => ({}) }) } }))
vi.mock('./utils', () => ({ getSessionWebBrowsing: vi.fn(() => false) }))
vi.mock('@/lib/utils', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import * as messages from './messages'

function msg(id: string, text: string, role: Message['role'] = 'user'): Message {
  return { id, role, contentParts: [{ type: 'text', text }] } as Message
}

const session = { id: 's1', name: 's1', type: 'chat', messages: [] } as unknown as Session

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue(session)
  mocks.estimateTokens.mockReturnValue(7)
})

describe('insertMessage / insertMessageAfter', () => {
  it('computes word and token counts before inserting', async () => {
    const m = msg('m1', 'hello brave new world')
    await messages.insertMessage('s1', m)
    expect(m.wordCount).toBe(4)
    expect(m.tokenCount).toBe(7)
    expect(mocks.insertMessage).toHaveBeenCalledWith('s1', m)
  })

  it('is a no-op when the session does not exist', async () => {
    mocks.getSession.mockResolvedValue(null)
    await messages.insertMessage('ghost', msg('m1', 'hi'))
    expect(mocks.insertMessage).not.toHaveBeenCalled()
  })

  it('insertMessageAfter passes the anchor message id through', async () => {
    const m = msg('m2', 'reply')
    await messages.insertMessageAfter('s1', m, 'm1')
    expect(mocks.insertMessage).toHaveBeenCalledWith('s1', m, 'm1')
    expect(m.wordCount).toBe(1)
  })
})

describe('modifyMessage', () => {
  it('persists via updateMessage and stamps a fresh timestamp', async () => {
    const m = msg('m1', 'edited')
    const before = Date.now()
    await messages.modifyMessage('s1', m)
    expect(m.timestamp).toBeGreaterThanOrEqual(before)
    expect(mocks.updateMessage).toHaveBeenCalledWith('s1', 'm1', m)
    expect(mocks.updateMessageCache).not.toHaveBeenCalled()
    // without refreshCounting the counts stay untouched
    expect(m.wordCount).toBeUndefined()
  })

  it('refreshCounting recomputes counts and clears tokenCountMap', async () => {
    const m = { ...msg('m1', 'one two three'), tokenCountMap: { old: 1 } } as unknown as Message
    await messages.modifyMessage('s1', m, true)
    expect(m.wordCount).toBe(3)
    expect(m.tokenCount).toBe(7)
    expect(m.tokenCountMap).toBeUndefined()
  })

  it('updateOnlyCache routes to the cache instead of storage', async () => {
    const m = msg('m1', 'cached')
    await messages.modifyMessage('s1', m, false, true)
    expect(mocks.updateMessageCache).toHaveBeenCalledWith('s1', 'm1', m)
    expect(mocks.updateMessage).not.toHaveBeenCalled()
  })
})

describe('streaming helpers', () => {
  it('updateStreamingCache only touches the cache and swallows failures', async () => {
    mocks.updateMessageCache.mockRejectedValueOnce(new Error('cache down'))
    const m = msg('m1', 'stream')
    expect(() => messages.updateStreamingCache('s1', m)).not.toThrow()
    await Promise.resolve() // let the rejection settle
    expect(mocks.updateMessageCache).toHaveBeenCalled()
    expect(mocks.updateMessage).not.toHaveBeenCalled()
  })

  it('persistStreamingMessage persists and optionally refreshes counts', async () => {
    const m = msg('m1', 'final answer text')
    await messages.persistStreamingMessage('s1', m)
    expect(m.wordCount).toBeUndefined()

    await messages.persistStreamingMessage('s1', m, { refreshCounting: true })
    expect(m.wordCount).toBe(3)
    expect(mocks.updateMessage).toHaveBeenCalledTimes(2)
  })
})

describe('removeMessage', () => {
  it('purges RAG attachments then removes the message', async () => {
    await messages.removeMessage('s1', 'm1')
    expect(mocks.deleteMessageAttachments).toHaveBeenCalledWith('m1')
    expect(mocks.removeMessage).toHaveBeenCalledWith('s1', 'm1')
  })

  it('still removes the message when RAG cleanup fails', async () => {
    mocks.deleteMessageAttachments.mockRejectedValueOnce(new Error('rag down'))
    await messages.removeMessage('s1', 'm1')
    expect(mocks.removeMessage).toHaveBeenCalledWith('s1', 'm1')
  })
})
