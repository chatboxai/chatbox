import { describe, expect, it, vi } from 'vitest'
import type { SessionSearchThreadsPage } from '../../ports/session-read-model'
import { type SessionMessageWindow, SessionRowConflictError } from '../../ports/session-row-store'
import type { Message, Session } from '../../types'
import { SessionSearchService, type SessionSearchPort } from './SessionSearchService'

const message = (id: string, text: string, role: Message['role'] = 'user'): Message => ({
  id,
  timestamp: 1,
  role,
  contentParts: [{ type: 'text', text }],
})
const session = (id: string, messages: Message[]): Session => ({ id, name: `Chat ${id}`, type: 'chat', messages })

function port(models: Record<string, SessionSearchThreadsPage | null>): SessionSearchPort {
  return {
    listSessionsMetaPage: vi
      .fn()
      .mockResolvedValue({ items: Object.keys(models).map((id) => ({ id })), nextCursor: null }),
    readSessionSearchThreadsPage: vi.fn(async ({ sessionId }) => models[sessionId] ?? null),
    readSessionMessageWindow: vi.fn().mockResolvedValue(null),
  }
}

function window(messages: Message[], before?: string): SessionMessageWindow {
  return {
    record: { id: 'a', name: 'Chat a', type: 'chat', activeThreadId: 'a', storageFormat: 'rows' },
    revision: 1,
    thread: {
      sessionId: 'a',
      threadId: 'a',
      seq: -1,
      name: null,
      createdAt: 1,
      rootMessageId: 'm1',
      activeLeafMessageId: 'm2',
      compactionPoints: [],
    },
    messages: messages.map((entry, index) => ({
      sessionId: 'a',
      threadId: 'a',
      messageId: entry.id,
      parentMessageId: index ? messages[index - 1].id : null,
      activeChildId: messages[index + 1]?.id ?? null,
      seq: index,
      kind: 'message',
      status: 'settled',
      createdAt: 1,
      updatedAt: 1,
      branchId: null,
      message: entry,
    })),
    newer: null,
    older: before ? { sessionId: 'a', threadId: 'a', revision: 1, beforeMessageId: before } : null,
  }
}

function threadPage(threadIds = ['a'], revision = 1, offset?: number): SessionSearchThreadsPage {
  return {
    kind: 'rows',
    header: { id: 'a', name: 'Chat a', type: 'chat' },
    revision,
    threadIds,
    nextCursor: offset === undefined ? null : { sessionId: 'a', revision, offset },
  }
}

const noYield = () => Promise.resolve()

describe('SessionSearchService', () => {
  it('does not read storage for empty input and treats regular-expression syntax literally', async () => {
    const source = port({ a: { kind: 'full', session: session('a', [message('m', 'literal a+b [x]')]) } })
    const search = new SessionSearchService(source, noYield)
    expect((await search.search('  ')).hits).toEqual([])
    expect(source.listSessionsMetaPage).not.toHaveBeenCalled()
    expect((await search.search('a+b [x]')).hits.map((hit) => hit.messageId)).toEqual(['m'])
    expect((await search.search('a+b [y]')).hits).toEqual([])
  })

  it('filters hidden prompts and searches archived threads on their selected paths', async () => {
    const value = session('a', [message('system', 'secret needle', 'system'), message('current', 'needle now')])
    value.threads = [{ id: 'old', name: 'Old', createdAt: 1, messages: [message('history', 'needle before')] }]
    const source = port({ a: { kind: 'full', session: value } })
    const search = new SessionSearchService(source, noYield)
    expect((await search.search('needle', { hideSystemPromptMessage: true })).hits.map((hit) => hit.messageId)).toEqual(
      ['current', 'history']
    )
    value.settings = { agentMode: { value: 'on', locked: false, lockReason: null } }
    expect((await search.search('needle')).hits.map((hit) => hit.messageId)).toEqual(['current', 'history'])
  })

  it('reads older windows without hydrating a complete session', async () => {
    const source = port({ a: threadPage() })
    source.readSessionMessageWindow = vi
      .fn()
      .mockResolvedValueOnce(window([message('m2', 'recent')], 'm2'))
      .mockResolvedValueOnce(window([message('m1', 'older needle')]))
    const result = await new SessionSearchService(source, noYield).search('needle')
    expect(result.hits.map((hit) => hit.messageId)).toEqual(['m1'])
    expect(source.readSessionMessageWindow).toHaveBeenCalledWith({
      sessionId: 'a',
      limit: 50,
      expectedRevision: 1,
      cursor: { sessionId: 'a', threadId: 'a', revision: 1, beforeMessageId: 'm2' },
    })
  })

  it('discards provisional results and retries a stale window once', async () => {
    const source = port({ a: threadPage() })
    source.readSessionMessageWindow = vi
      .fn()
      .mockResolvedValueOnce(window([message('stale', 'needle old')], 'stale'))
      .mockRejectedValueOnce(new SessionRowConflictError('a', 1, 2))
      .mockResolvedValueOnce({ ...window([message('fresh', 'needle new')]), revision: 2 })
    source.readSessionSearchThreadsPage = vi
      .fn()
      .mockResolvedValueOnce(threadPage())
      .mockResolvedValueOnce(threadPage(['a'], 2))
    const result = await new SessionSearchService(source, noYield).search('needle')
    expect(result.hits.map((hit) => hit.messageId)).toEqual(['fresh'])
    expect(result.failedSessionIds).toEqual([])
    expect(source.readSessionSearchThreadsPage).toHaveBeenCalledTimes(2)
  })

  it('uses one revision fence across threads and discards earlier-thread hits on a conflict', async () => {
    const source = port({ a: threadPage(['a', 'history']) })
    source.readSessionMessageWindow = vi
      .fn()
      .mockResolvedValueOnce(window([message('stale', 'needle old')]))
      .mockRejectedValueOnce(new SessionRowConflictError('a', 1, 2))
      .mockResolvedValueOnce({ ...window([message('fresh', 'needle now')]), revision: 2 })
      .mockResolvedValueOnce({ ...window([message('older', 'needle history')]), revision: 2 })
    source.readSessionSearchThreadsPage = vi
      .fn()
      .mockResolvedValueOnce(threadPage(['a', 'history']))
      .mockResolvedValueOnce(threadPage(['a', 'history'], 2))
    const progress = vi.fn()
    const result = await new SessionSearchService(source, noYield).search('needle', { onProgress: progress })
    expect(result.hits.map((hit) => hit.messageId)).toEqual(['fresh', 'older'])
    expect(source.readSessionMessageWindow).toHaveBeenNthCalledWith(2, {
      sessionId: 'a',
      threadId: 'history',
      limit: 50,
      expectedRevision: 1,
    })
    expect(source.readSessionMessageWindow).toHaveBeenNthCalledWith(4, {
      sessionId: 'a',
      threadId: 'history',
      limit: 50,
      expectedRevision: 2,
    })
    const staleProgress = progress.mock.calls.findIndex(([snapshot]) =>
      snapshot.hits.some((hit: { messageId?: string }) => hit.messageId === 'stale')
    )
    expect(staleProgress).toBeGreaterThanOrEqual(0)
    expect(progress.mock.calls.slice(staleProgress + 1).some(([snapshot]) => snapshot.hits.length === 0)).toBe(true)
    expect(result.failedSessionIds).toEqual([])
  })

  it('paginates thread enumeration and bounds every message request', async () => {
    const source = port({ a: threadPage(['a'], 1, 1) })
    source.readSessionSearchThreadsPage = vi
      .fn()
      .mockResolvedValueOnce(threadPage(['a'], 1, 1))
      .mockResolvedValueOnce(threadPage(['old']))
    source.readSessionMessageWindow = vi
      .fn()
      .mockResolvedValueOnce(window([message('current', 'no match')]))
      .mockResolvedValueOnce(window([message('old', 'needle old')]))
    const result = await new SessionSearchService(source, noYield).search('needle')
    expect(result.hits.map((hit) => hit.messageId)).toEqual(['old'])
    expect(source.readSessionSearchThreadsPage).toHaveBeenNthCalledWith(2, {
      sessionId: 'a',
      limit: 20,
      cursor: { sessionId: 'a', revision: 1, offset: 1 },
    })
    expect(source.readSessionMessageWindow).toHaveBeenCalledWith({
      sessionId: 'a',
      threadId: 'old',
      limit: 50,
      expectedRevision: 1,
    })
  })

  it('retries a thread-page conflict only once and isolates a repeatedly changing session', async () => {
    const source = port({ a: threadPage(['a'], 1, 1) })
    source.readSessionSearchThreadsPage = vi
      .fn()
      .mockResolvedValueOnce(threadPage(['a'], 1, 1))
      .mockRejectedValueOnce(new SessionRowConflictError('a', 1, 2))
      .mockResolvedValueOnce(threadPage(['a'], 2, 1))
      .mockRejectedValueOnce(new SessionRowConflictError('a', 2, 3))
    source.readSessionMessageWindow = vi
      .fn()
      .mockResolvedValueOnce(window([message('stale', 'needle')]))
      .mockResolvedValueOnce({ ...window([message('stale2', 'needle')]), revision: 2 })
    const result = await new SessionSearchService(source, noYield).search('needle')
    expect(result.hits).toEqual([])
    expect(result.failedSessionIds).toEqual(['a'])
    expect(source.readSessionSearchThreadsPage).toHaveBeenCalledTimes(4)
  })

  it('stops reading more threads and sessions when the result limit is reached', async () => {
    const source = port({ a: threadPage(['a', 'unread'], 1, 2), b: threadPage(['b']) })
    source.readSessionMessageWindow = vi
      .fn()
      .mockResolvedValue(window([message('m1', 'needle'), message('m2', 'needle')]))
    const result = await new SessionSearchService(source, noYield).search('needle', { limit: 2 })
    expect(result.limitReached).toBe(true)
    expect(result.hits).toHaveLength(2)
    expect(source.readSessionSearchThreadsPage).toHaveBeenCalledTimes(1)
    expect(source.readSessionMessageWindow).toHaveBeenCalledTimes(1)
  })

  it('caps results and preview sizes while retaining partial progress across corrupt sessions', async () => {
    const source = port({
      a: null,
      b: {
        kind: 'full',
        session: session('b', [message('m1', 'needle'.repeat(2000)), message('m2', 'needle'), message('m3', 'needle')]),
      },
    })
    source.readSessionSearchThreadsPage = vi.fn(async ({ sessionId: id }) => {
      if (id === 'a') throw new Error('corrupt session')
      return {
        kind: 'full' as const,
        session: session('b', [message('m1', 'needle'.repeat(2000)), message('m2', 'needle')]),
      }
    })
    const result = await new SessionSearchService(source, noYield).search('needle', { limit: 2 })
    expect(result.hits).toHaveLength(2)
    expect(result.hits.every((hit) => hit.preview.length <= 322)).toBe(true)
    expect(result.limitReached).toBe(true)
    expect(result.failedSessionIds).toEqual(['a'])
  })

  it('stops an obsolete query before issuing another message read', async () => {
    const controller = new AbortController()
    const source = port({ a: threadPage() })
    source.readSessionMessageWindow = vi.fn().mockResolvedValue(window([message('m', 'needle')], 'm'))
    const search = new SessionSearchService(source, async () => controller.abort(new Error('superseded')))
    await expect(search.search('needle', { signal: controller.signal })).rejects.toThrow('superseded')
    expect(source.readSessionMessageWindow).toHaveBeenCalledTimes(1)
  })
  it('checks cancellation after a thread page arrives, before its first message read', async () => {
    const controller = new AbortController()
    const source = port({ a: threadPage() })
    source.readSessionSearchThreadsPage = vi.fn(async () => {
      controller.abort(new Error('superseded'))
      return threadPage()
    })
    await expect(
      new SessionSearchService(source, noYield).search('needle', { signal: controller.signal })
    ).rejects.toThrow('superseded')
    expect(source.readSessionMessageWindow).not.toHaveBeenCalled()
  })

  it('checks cancellation before reading another thread page even when the current thread is empty', async () => {
    const controller = new AbortController()
    const source = port({ a: threadPage(['a'], 1, 1) })
    source.readSessionMessageWindow = vi.fn().mockResolvedValue(window([]))
    const search = new SessionSearchService(source, async () => controller.abort(new Error('superseded')))
    await expect(search.search('needle', { signal: controller.signal })).rejects.toThrow('superseded')
    expect(source.readSessionSearchThreadsPage).toHaveBeenCalledTimes(1)
  })
})
