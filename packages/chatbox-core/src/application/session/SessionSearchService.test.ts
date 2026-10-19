import { describe, expect, it, vi } from 'vitest'
import { SessionRowConflictError } from '../../ports/session-row-store'
import { InMemorySessionRepository } from '../../testing/InMemorySessionRepository'
import type { Message, Session } from '../../types'
import { SessionSearchService, type SessionSearchPort } from './SessionSearchService'

const message = (id: string, text: string, role: Message['role'] = 'user'): Message => ({
  id,
  timestamp: 1,
  role,
  contentParts: [{ type: 'text', text }],
})
const session = (id: string, messages: Message[]): Session => ({ id, name: `Chat ${id}`, type: 'chat', messages })
const noYield = () => Promise.resolve()

async function harness(values: Session[], yieldControl = noYield) {
  const repository = new InMemorySessionRepository()
  for (const value of values) await repository.seedSession(value)
  const source: SessionSearchPort = {
    listSessionsMetaPage: vi.fn(async () => ({
      items: values.map(({ id, name }) => ({ id, name, sortOrder: 1, createdAt: 1 })),
      nextCursor: null,
      total: values.length,
    })),
    readSessionSearchCandidates: vi.fn((request) => repository.readSessionSearchCandidates(request)),
    readSessionSearchWindow: vi.fn((request) => repository.readSessionSearchWindow(request)),
  }
  return { repository, source, search: new SessionSearchService(source, yieldControl) }
}

const many = () =>
  Array.from({ length: 105 }, (_, index) => message(`m${index}`, index === 1 ? 'older needle' : 'ordinary'))

describe('SessionSearchService', () => {
  it('does not read storage for empty input and treats regular-expression syntax literally', async () => {
    const { search, source } = await harness([session('a', [message('m', 'literal a+b [x]')])])
    expect((await search.search('  ')).hits).toEqual([])
    expect(source.listSessionsMetaPage).not.toHaveBeenCalled()
    expect((await search.search('a+b [x]')).hits.map((hit) => hit.messageId)).toEqual(['m'])
    expect((await search.search('a+b [y]')).hits).toEqual([])
  })

  it('filters prompts and searches archived selected paths, excluding inactive forks', async () => {
    const value = session('a', [message('system', 'secret needle', 'system'), message('current', 'needle now')])
    value.threads = [{ id: 'old', name: 'Old', createdAt: 1, messages: [message('history', 'needle before')] }]
    value.messageForksHash = {
      current: {
        position: 0,
        createdAt: 1,
        lists: [
          { id: 'selected', messages: [] },
          { id: 'other', messages: [message('inactive', 'needle hidden')] },
        ],
      },
    }
    const { search, repository } = await harness([value])
    expect((await search.search('needle', { hideSystemPromptMessage: true })).hits.map((hit) => hit.messageId)).toEqual(
      ['current', 'history']
    )
    await repository.executeSessionCommand('a', {
      type: 'header',
      updater: { settings: { agentMode: { value: 'on', locked: false, lockReason: null } } },
    })
    expect((await search.search('needle')).hits.map((hit) => hit.messageId)).toEqual(['current', 'history'])
  })

  it('follows bounded older cursors across threads', async () => {
    const value = session('a', many())
    value.threads = Array.from({ length: 25 }, (_, index) => ({
      id: `t${index}`,
      name: 'Old',
      createdAt: index,
      messages: [message(`old${index}`, index === 0 ? 'needle history' : 'ordinary')],
    }))
    const { search, source } = await harness([value])
    expect((await search.search('needle')).hits.map((hit) => hit.messageId)).toEqual(['m1', 'old0'])
    const calls = vi
      .mocked(source.readSessionSearchWindow)
      .mock.calls.filter(([request]) => request.messageId === undefined)
    expect(calls.length).toBeGreaterThan(2)
    expect(calls[0][0].cursor).toBeUndefined()
    expect(
      calls
        .slice(1)
        .every(
          ([request]) =>
            request.cursor?.direction === 'before' &&
            request.cursor.limit === 50 &&
            request.cursor.maxBytes === 2 * 1024 * 1024
        )
    ).toBe(true)
  })

  it.each([2, Number.POSITIVE_INFINITY])(
    'finds history with %s checkpoints between search batches',
    async (checkpoints) => {
      let writes = 0
      let yields = 0
      let repository: InMemorySessionRepository
      const values = Array.from({ length: 301 }, (_, index) =>
        message(`m${index}`, index === 1 ? 'historical needle' : 'ordinary')
      )
      const fixture = await harness([session('a', values)], async () => {
        if (++yields % 2 === 0 || writes >= checkpoints) return
        writes++
        await repository.executeSessionCommand('a', {
          type: 'update',
          messageId: 'm300',
          updater: { contentParts: [{ type: 'text', text: `stream checkpoint ${writes}` }] },
        })
      })
      repository = fixture.repository
      const result = await fixture.search.search('needle', { sessionId: 'a' })
      expect(result.failedSessionIds).toEqual([])
      expect(result.hits.map((hit) => hit.messageId)).toEqual(['m1'])
      expect(writes).toBeGreaterThanOrEqual(2)
    }
  )

  it('rechecks a provisional hit after a concurrent edit without restarting the scan', async () => {
    const values = many()
    values[104] = message('m104', 'needle stale')
    const { search, source, repository } = await harness([session('a', values)])
    let reads = 0
    vi.mocked(source.readSessionSearchWindow).mockImplementation(async (request) => {
      if (++reads === 2)
        await repository.executeSessionCommand('a', {
          type: 'update',
          messageId: 'm104',
          updater: { contentParts: [{ type: 'text', text: 'no match now' }] },
        })
      return repository.readSessionSearchWindow(request)
    })
    const progress = vi.fn()
    const result = await search.search('needle', { onProgress: progress })
    expect(result.hits.map((hit) => hit.messageId)).toEqual(['m1'])
    expect(result.failedSessionIds).toEqual([])
    expect(source.readSessionSearchCandidates).toHaveBeenCalledTimes(2)
    const stale = progress.mock.calls.findIndex(([value]) =>
      value.hits.some((hit: { messageId?: string }) => hit.messageId === 'm104')
    )
    expect(stale).toBeGreaterThanOrEqual(0)
    expect(progress.mock.calls.at(-1)?.[0].hits.map((hit: { messageId?: string }) => hit.messageId)).toEqual(['m1'])
    expect(
      vi.mocked(source.readSessionSearchWindow).mock.calls.filter(([request]) => !request.cursor && !request.messageId)
    ).toHaveLength(1)
  })

  it('isolates a repeatedly changing session after one retry', async () => {
    const { search, source } = await harness([session('a', many())])
    vi.mocked(source.readSessionSearchWindow).mockRejectedValue(new SessionRowConflictError('a', 1, 2))
    expect(await search.search('needle')).toEqual({ hits: [], limitReached: false, failedSessionIds: ['a'] })
    expect(source.readSessionSearchCandidates).toHaveBeenCalledTimes(2)
  })

  it('stops at the result limit before another page or session and caps previews', async () => {
    const { search, source } = await harness([
      session('a', [message('m1', 'needle'.repeat(2000)), message('m2', 'needle')]),
      session('b', many()),
    ])
    const result = await search.search('needle', { limit: 2 })
    expect(result.limitReached).toBe(true)
    expect(result.hits).toHaveLength(2)
    expect(result.hits.every((hit) => hit.preview.length <= 322)).toBe(true)
    expect(source.readSessionSearchCandidates).toHaveBeenCalledTimes(2)
    expect(source.readSessionSearchWindow).toHaveBeenCalledTimes(3)
  })

  it('retains progress from readable sessions when another header is corrupt', async () => {
    const { search, source, repository } = await harness([session('a', []), session('b', [message('m', 'needle')])])
    vi.mocked(source.readSessionSearchCandidates).mockImplementation(async (request) => {
      if (request.sessionId === 'a') throw new Error('corrupt')
      return repository.readSessionSearchCandidates(request)
    })
    const result = await search.search('needle')
    expect(result.failedSessionIds).toEqual(['a'])
    expect(result.hits.map((hit) => hit.messageId)).toEqual(['m'])
  })

  it('checks cancellation before another body page', async () => {
    const controller = new AbortController()
    const { search, source } = await harness([session('a', many())], async () =>
      controller.abort(new Error('superseded'))
    )
    await expect(search.search('needle', { signal: controller.signal })).rejects.toThrow('superseded')
    expect(source.readSessionSearchWindow).toHaveBeenCalledTimes(1)
  })

  it('checks cancellation after a header arrives before reading any body', async () => {
    const controller = new AbortController()
    const { search, source, repository } = await harness([session('a', many())])
    vi.mocked(source.readSessionSearchCandidates).mockImplementation(async (request) => {
      controller.abort(new Error('superseded'))
      return repository.readSessionSearchCandidates(request)
    })
    await expect(search.search('needle', { signal: controller.signal })).rejects.toThrow('superseded')
    expect(source.readSessionSearchWindow).not.toHaveBeenCalled()
  })

  it('rejects an unadvanced continuation instead of rereading indefinitely', async () => {
    const { search, source, repository } = await harness([session('a', many())])
    const page = await repository.readSessionSearchWindow({ sessionId: 'a' })
    vi.mocked(source.readSessionSearchWindow).mockResolvedValue(page)
    expect((await search.search('needle')).failedSessionIds).toEqual(['a'])
    expect(source.readSessionSearchWindow).toHaveBeenCalledTimes(2)
  })
  it('drops a deleted or deselected provisional candidate before returning', async () => {
    const value = session('a', many())
    value.messages[104] = message('m104', 'needle provisional')
    value.messageForksHash = {
      m103: {
        position: 0,
        createdAt: 1,
        lists: [
          { id: 'selected', messages: [] },
          { id: 'other', messages: [message('alternate', 'ordinary')] },
        ],
      },
    }
    const { repository, source, search } = await harness([value])
    let reads = 0
    vi.mocked(source.readSessionSearchWindow).mockImplementation(async (request) => {
      if (++reads === 2)
        await repository.executeSessionCommand('a', {
          type: 'structure',
          operation: { action: 'fork-switch', pivotId: 'm103', target: 'next' },
        })
      return repository.readSessionSearchWindow(request)
    })
    const result = await search.search('needle', { sessionId: 'a' })
    expect(result.failedSessionIds).toEqual([])
    expect(result.hits.map((hit) => hit.messageId)).toEqual(['m1'])
  })

  it('rechecks title and prompt visibility with the final current header', async () => {
    const { repository, source, search } = await harness([
      { ...session('a', [message('system', 'needle', 'system')]), name: 'needle title' },
    ])
    let reads = 0
    vi.mocked(source.readSessionSearchCandidates).mockImplementation(async (request) => {
      if (++reads === 2)
        await repository.executeSessionCommand('a', {
          type: 'header',
          updater: { name: 'Renamed', settings: { agentMode: { value: 'on', locked: false, lockReason: null } } },
        })
      return repository.readSessionSearchCandidates(request)
    })
    expect(await search.search('needle', { sessionId: 'a' })).toEqual({
      hits: [],
      failedSessionIds: [],
      limitReached: false,
    })
  })

  it('restarts once when a selected cursor anchor disappears, excluding its stale hits', async () => {
    const { repository, source, search } = await harness([session('a', many())])
    let removed = false
    vi.mocked(source.readSessionSearchWindow).mockImplementation(async (request) => {
      if (request.cursor?.messageId && !removed) {
        removed = true
        await repository.executeSessionCommand('a', {
          type: 'structure',
          operation: {
            action: 'message-remove',
            messageId: request.cursor.messageId,
            replacementPivotId: 'replacement',
          },
        })
      }
      return repository.readSessionSearchWindow(request)
    })
    const result = await search.search('needle', { sessionId: 'a' })
    expect(result.failedSessionIds).toEqual([])
    expect(result.hits.map((hit) => hit.messageId)).toEqual(['m1'])
    expect(
      vi.mocked(source.readSessionSearchWindow).mock.calls.filter(([request]) => !request.cursor && !request.messageId)
    ).toHaveLength(2)
  })

  it('keeps candidate body checks one row at a time and metadata checks at the result limit', async () => {
    const { repository, source, search } = await harness([
      session(
        'a',
        Array.from({ length: 60 }, (_, index) => message(`m${index}`, 'needle'))
      ),
    ])
    const bodyReads = vi.spyOn(repository.rowStore, 'readTranscriptWindow')
    const result = await search.search('needle', { sessionId: 'a', limit: 3 })
    expect(result.hits).toHaveLength(3)
    expect(bodyReads.mock.calls.map(([request]) => request.limit)).toEqual([50, 1, 1, 1])
    expect(bodyReads.mock.calls.every(([request]) => request.maxBytes === 2 * 1024 * 1024)).toBe(true)
    expect(vi.mocked(source.readSessionSearchCandidates).mock.calls.at(-1)?.[0].messageIds).toEqual([
      'm59',
      'm58',
      'm57',
    ])
  })

  it('filters a candidate deselected after its body check in the final metadata batch', async () => {
    const value = session('a', [message('pivot', 'ordinary'), message('selected', 'needle')])
    value.messageForksHash = {
      pivot: {
        position: 0,
        createdAt: 1,
        lists: [
          { id: 'old', messages: [] },
          { id: 'new', messages: [message('alternate', 'ordinary')] },
        ],
      },
    }
    const { repository, source, search } = await harness([value])
    let checks = 0
    vi.mocked(source.readSessionSearchCandidates).mockImplementation(async (request) => {
      if (++checks === 2)
        await repository.executeSessionCommand('a', {
          type: 'structure',
          operation: {
            action: 'fork-switch',
            pivotId: 'pivot',
            target: 'next',
          },
        })
      return repository.readSessionSearchCandidates(request)
    })
    expect((await search.search('needle', { sessionId: 'a' })).hits).toEqual([])
    expect(vi.mocked(source.readSessionSearchCandidates).mock.calls.at(-1)?.[0].messageIds).toEqual(['selected'])
  })
})
