import type { Session } from '@chatbox/core'
import { RowBackedSessionRepository } from '@chatbox/core/application/session'
import type { SessionTextTokenResult } from '@chatbox/core/ports'
import { InMemorySessionRecordStore } from '@chatbox/core/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openNodeSessionRowDatabase } from '../../../../../packages/chatbox-core/src/persistence/node-sqlite.test-support'
import {
  type SessionRowSqlBindValue,
  SqlSessionRowStore,
} from '../../../../../packages/chatbox-core/src/persistence/session-row-sql'
import { ResultPersister } from '../result-persister'

const { accept, patch, read } = vi.hoisted(() => ({ accept: vi.fn(), patch: vi.fn(), read: vi.fn() }))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: {
      acceptSessionTextTokenResults: accept,
      patchSessionMessageDerivedData: patch,
      readSessionMessages: read,
    },
  },
}))

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const close of cleanup.splice(0)) close()
  vi.restoreAllMocks()
  vi.useRealTimers()
  accept.mockReset()
  patch.mockReset()
  read.mockReset()
})

describe('ResultPersister SQL transaction completion', () => {
  it.each(['transaction', 'readback'] as const)(
    'retains an entire flush after a partial %s failure and retries it',
    async (failure) => {
      vi.useFakeTimers()
      vi.setSystemTime(0)
      const database = openNodeSessionRowDatabase()
      const rows = new SqlSessionRowStore(database)
      const repo = new RowBackedSessionRepository({ rows, records: new InMemorySessionRecordStore() })
      const persister = new ResultPersister()
      cleanup.push(() => {
        persister.cancel()
        database.close()
      })
      const session: Session = {
        id: `s-${'x'.repeat(160)}`,
        name: 's',
        type: 'chat',
        messages: Array.from({ length: 1000 }, (_, i) => ({
          id: `m${i}`,
          role: 'user',
          timestamp: 1,
          contentParts: [{ type: 'text', text: `text ${i}` }],
        })),
      }
      await repo.setSession(session)
      const context = await repo.getSessionContextSource({ sessionId: session.id })
      const sources = Object.values(context?.textTokens?.sources ?? {})
      expect(sources).toHaveLength(1000)
      accept.mockImplementation((sessionId: string, results: SessionTextTokenResult[]) =>
        repo.acceptSessionTextTokenResults(sessionId, results)
      )

      let reached!: () => void
      let release!: () => void
      const atFailure = new Promise<void>((resolve) => {
        reached = resolve
      })
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      let inject = true
      let transactions = 0
      const execute = database.executeBatch.bind(database)
      vi.spyOn(database, 'executeBatch').mockImplementation(async (statements, options) => {
        transactions++
        if (inject && failure === 'transaction' && transactions === 2) {
          reached()
          await gate
          inject = false
          const batch = Array.from(statements)
          return execute(
            [
              batch[0],
              { sql: 'INSERT INTO session_row_revision_guard(value) VALUES(1)', params: [] },
              ...batch.slice(1),
            ],
            options
          )
        }
        return execute(statements, options)
      })
      const query = database.query.bind(database)
      vi.spyOn(database, 'query').mockImplementation(
        async <T>(sql: string, params?: SessionRowSqlBindValue[]): Promise<T[]> => {
          if (inject && failure === 'readback' && sql.startsWith('WITH requested')) {
            reached()
            await gate
            inject = false
            throw new Error('Readback unavailable')
          }
          return query<T>(sql, params)
        }
      )

      const results = sources.map((source) => ({
        type: 'message-text' as const,
        sessionId: session.id,
        messageId: source.messageId,
        tokenizerType: 'default' as const,
        textSource: source,
        textDigest: source.textDigest,
        tokens: 7,
        calculatedAt: 100,
        approximate: false,
      }))
      for (const result of results) persister.addResult(result)
      const notified = vi.fn()
      persister.subscribe(notified)
      let settled = false
      const flush = persister.flushNow().finally(() => {
        settled = true
      })
      const rejected = expect(flush).rejects.toThrow('remains pending')
      await atFailure
      expect(settled).toBe(false)
      expect(notified).not.toHaveBeenCalled()
      expect(persister.hasPendingExactTextResult(results[0])).toBe(true)
      const beforeFailure = (
        await database.query<{ count: number }>('SELECT COUNT(*) AS count FROM session_text_tokens')
      )[0].count
      release()
      await rejected
      expect(persister.getPendingCount()).toBe(1000)
      const persisted = (
        await database.query<{ count: number }>('SELECT COUNT(*) AS count FROM session_text_tokens')
      )[0].count
      expect(persisted).toBeGreaterThan(0)
      expect(persisted).toBeLessThan(1000)
      expect(persisted).toBe(beforeFailure)
      await vi.advanceTimersByTimeAsync(5000)
      expect(accept).toHaveBeenCalledTimes(1)
      await persister.flushNow()
      expect(persister.getPendingCount()).toBe(0)
      expect(accept).toHaveBeenCalledTimes(2)
      expect(patch).not.toHaveBeenCalled()
      expect(read).not.toHaveBeenCalled()
      const accepted = await rows.readTextTokenResults(sources)
      expect(accepted).toHaveLength(1000)
      expect(
        accepted.every(
          (result) => result.value.tokens === 7 && result.value.calculatedAt === 100 && !result.value.approximate
        )
      ).toBe(true)
      expect(await rows.getRevision(session.id)).toBe(1)
    }
  )
})
