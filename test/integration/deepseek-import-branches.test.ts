import { afterEach, describe, expect, it, vi } from 'vitest'
import { convertDeepSeekSession } from '../../packages/chatbox-core/src/importers/deepseek/convert'
import type {
  SessionRowSqlBindValue,
  SessionRowSqlDatabase,
} from '../../packages/chatbox-core/src/persistence/session-row-sql'
import { acknowledge, drivers, setupRows } from './session-rows-harness'

const cleanups: Array<() => void> = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0)) cleanup()
})
const at = '2024-01-01T00:00:00Z'
const message = (id: number, parent_id: number | null, role: 'USER' | 'ASSISTANT' = 'USER') => ({
  id,
  parent_id,
  role,
  status: 'FINISHED',
  inserted_at: at,
  fragments: [{ type: role === 'USER' ? 'REQUEST' : 'RESPONSE', content: `message-${id}` }],
})

describe.each(drivers)('imported DeepSeek branch reads on %s', (driver) => {
  const queuedModes = driver === 'sqlite' ? [false, true] : [false]
  it.each(queuedModes)('preserves imported messages through branch navigation (queued reads: %s)', async (queued) => {
    const h = await setupRows(driver)
    cleanups.push(h.dispose)
    const converted = await convertDeepSeekSession(
      {
        id: 'deepseek-source',
        title: 'DeepSeek branches',
        pinned: false,
        inserted_at: at,
        updated_at: at,
        current_message_id: 5,
        messages: [
          message(1, null),
          message(2, 1, 'ASSISTANT'),
          message(3, 1, 'ASSISTANT'),
          message(4, 2),
          message(5, 4, 'ASSISTANT'),
          message(6, null),
          message(7, 6, 'ASSISTANT'),
        ],
      },
      {
        sessionId: 's',
        importedAt: 1,
        failureLabel: 'Failed',
        resolveImage: async () => null,
        issue: (issue) => {
          throw new Error(JSON.stringify(issue))
        },
      }
    )
    await h.rows.deleteRows('s')
    const writer = await h.rows.stageImportRows(converted.record, 'deepseek-branches-test')
    await writer.appendThread(converted.thread)
    await writer.appendRows(converted.rows.map((message) => ({ kind: 'message', message })))
    await writer.prepare()
    await writer.publish()
    if (queued) {
      const database = Reflect.get(h.rows, 'database') as SessionRowSqlDatabase | undefined
      if (!database) throw new Error('Queued reads require a SQLite database')
      const query = database.query.bind(database)
      vi.spyOn(database, 'query').mockImplementation(async <T>(sql: string, params?: SessionRowSqlBindValue[]) => {
        const result = await query<T>(sql, params)
        await new Promise((resolve) => setTimeout(resolve, 1))
        return result
      })
    }
    const controller = await h.openWindow(20)
    const assertPage = async (ids: string[]) => {
      await vi.waitFor(
        () => {
          const state = controller.getSnapshot()
          if (state.operation?.phase === 'error') throw state.operation.error
          expect(state.rows.map((row) => row.messageId)).toEqual(ids.map((id) => `s:${id}`))
        },
        { timeout: 5000 }
      )
      acknowledge(controller)
    }
    await assertPage(['root', '1', '2', '4', '5'])
    for (const step of [
      { pivot: '1', target: 'next' as const, ids: ['root', '1', '3'] },
      { pivot: 'root', target: 'next' as const, ids: ['root', '6', '7'] },
      { pivot: 'root', target: 'prev' as const, ids: ['root', '1', '3'] },
      { pivot: '1', target: 'prev' as const, ids: ['root', '1', '2', '4', '5'] },
    ]) {
      await h.service.executeStructureCommand('s', {
        action: 'fork-switch',
        pivotId: `s:${step.pivot}`,
        target: step.target,
      })
      if (step.pivot === 'root' && step.target === 'next') {
        // Simulate a stale click on the previous branch's nested fork after switching the root fork.
        const revision = await h.rows.getRevision('s')
        const stale = await h.service.executeStructureCommand('s', {
          action: 'fork-switch',
          pivotId: 's:1',
          target: 'prev',
        })
        expect(stale.applied).toBe(false)
        expect(await h.rows.getRevision('s')).toBe(revision)
      }
      if (!queued) await assertPage(step.ids)
    }
    await assertPage(['root', '1', '2', '4', '5'])
    const stored = []
    for await (const row of h.rows.iterateRows({ sessionId: 's' })) if (row.kind === 'message') stored.push(row.message)
    expect(stored).toHaveLength(8)
    expect(stored.map((row) => row.messageId).sort()).toEqual(
      ['root', '1', '2', '3', '4', '5', '6', '7'].map((id) => `s:${id}`).sort()
    )
    for (const row of stored)
      if (row.activeChildId)
        expect(stored.find((child) => child.messageId === row.activeChildId)?.parentMessageId).toBe(row.messageId)
  })
})
