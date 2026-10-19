import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemorySessionRowStore } from '../testing/InMemorySessionRowStore'
import { testTokenCache } from '../ports/testing/session-token-cache-contract'
import { openNodeSessionRowDatabase, type NodeSessionRowSqlDatabase } from './node-sqlite.test-support'
import { SqlSessionRowStore } from './session-row-sql'
import { InMemorySessionRepository } from '../testing/InMemorySessionRepository'
import { TokenEstimationService } from '../application/token-estimation/TokenEstimationService'
import { SESSION_TOKEN_CACHE_VERSION, SESSION_TOKEN_PAGE_BYTES } from '../ports/session-token-cache'
const databases: NodeSessionRowSqlDatabase[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const db of databases.splice(0)) db.close()
})
for (const kind of ['memory', 'SQL'] as const)
  describe(`${kind} numerical token projection`, () => {
    it('returns warm counts without body reads and rejects stale payload results', async () => {
      if (kind === 'memory') return testTokenCache(new InMemorySessionRowStore())
      const db = openNodeSessionRowDatabase()
      databases.push(db)
      await testTokenCache(new SqlSessionRowStore(db))
    })
  })
it('warms numerical history once and rehydrates only a newly appended message', async () => {
  const repo = new InMemorySessionRepository()
  await repo.createSessionRows({ id: 'tokens', name: 'Tokens' }, [
    { id: 'first', role: 'user', contentParts: [{ type: 'text', text: 'hello' }] },
  ])
  const service = new TokenEstimationService({ get: async () => null }, repo)
  const body = vi.spyOn(repo.rowStore, 'readMessages')
  const first = await service.estimate({ sessionId: 'tokens' })
  expect(body).toHaveBeenCalledTimes(1)
  body.mockClear()
  expect((await service.estimate({ sessionId: 'tokens' })).contextTokens).toBe(first.contextTokens)
  expect(body).not.toHaveBeenCalled()
  await repo.executeSessionCommand('tokens', {
    type: 'append',
    messages: [{ id: 'next', role: 'assistant', contentParts: [{ type: 'text', text: 'world' }] }],
  })
  body.mockClear()
  await service.estimate({ sessionId: 'tokens' })
  expect(body.mock.calls.map(([request]) => request.messageIds)).toEqual([['next']])
})
it('limits cache-miss payload pages by bytes and keeps one oversized message alone', async () => {
  const repo = new InMemorySessionRepository()
  await repo.createSessionRows(
    { id: 'large', name: 'Large' },
    ['a', 'b'].map((id) => ({
      id,
      role: 'user' as const,
      contentParts: [{ type: 'text' as const, text: id.repeat(SESSION_TOKEN_PAGE_BYTES + 1) }],
    }))
  )
  const plan = (await repo.createSessionTokenPlan({ sessionId: 'large' }))!
  const body = vi.spyOn(repo.rowStore, 'readMessages')
  const first = await repo.readSessionTokenPage({
    plan,
    offset: 0,
    limit: 16,
    cacheKey: `${SESSION_TOKEN_CACHE_VERSION}:default:0:0`,
  })
  expect(first.messages.map((message) => message.id)).toEqual(['a'])
  expect(first.nextOffset).toBe(1)
  expect(body.mock.calls[0][0].messageIds).toEqual(['a'])
})
it('rechecks mutable attachment content while reusing independent plain-text counts', async () => {
  const repo = new InMemorySessionRepository()
  await repo.createSessionRows({ id: 'files', name: 'Files' }, [
    { id: 'plain', role: 'user', contentParts: [{ type: 'text', text: 'hello' }] },
    {
      id: 'attachment',
      role: 'user',
      contentParts: [],
      files: [{ id: 'asset', name: 'notes.txt', storageKey: 'mutable-key', fileType: 'text/plain', byteLength: 1 }],
    },
  ])
  let content = 'short'
  const service = new TokenEstimationService({ get: async () => content }, repo)
  const first = await service.estimate({ sessionId: 'files' })
  content = 'a much longer attachment '.repeat(100)
  const body = vi.spyOn(repo.rowStore, 'readMessages')
  const second = await service.estimate({ sessionId: 'files' })
  expect(second.contextTokens).toBeGreaterThan(first.contextTokens)
  expect(body.mock.calls.map(([request]) => request.messageIds)).toEqual([['attachment']])
})
