import { describe, expect, test, vi } from 'vitest'
import { SessionRowConflictError } from '../../ports/session-row-store'
import { decodeSessionTree, deriveSessionRecord } from '../../session/session-tree'
import { InMemorySessionRecordStore } from '../../testing/InMemorySessionRecordStore'
import { InMemorySessionRowStore } from '../../testing/InMemorySessionRowStore'
import type { Message, Session } from '../../types/session'
import { RowBackedSessionRepository } from './RowBackedSessionRepository'

function plain(): Session {
  return {
    id: 's',
    name: 'Chat',
    type: 'chat',
    threadName: 'Chat',
    settings: { agentMode: { value: 'off', locked: false, lockReason: null } },
    messages: Array.from({ length: 120 }, (_, index) => ({
      id: `m${index}`,
      role: index % 2 ? 'assistant' : 'user',
      contentParts: [{ type: 'text', text: `Message ${index}` }],
    })),
  }
}

function repository() {
  const records = new InMemorySessionRecordStore()
  const rows = new InMemorySessionRowStore()
  return { records, rows, repo: new RowBackedSessionRepository({ records, rows, now: () => 1 }) }
}

describe('session read models', () => {
  test('reads a bounded transcript without a full snapshot or leaking a writable Session', async () => {
    const { repo, rows } = repository()
    await repo.setSession(plain())
    const readSnapshot = vi.spyOn(rows, 'readSnapshot')
    const model = await repo.getSessionReadModel('s')
    expect(model?.kind).toBe('window')
    if (model?.kind !== 'window') throw new Error('expected window')
    expect(model.window.messages.map((row) => row.messageId)).toEqual(
      plain()
        .messages.slice(-50)
        .map((message) => message.id)
    )
    expect(model.summary.userMessageCount).toBe(60)
    expect(model.header).not.toHaveProperty('messages')
    expect(model.header).not.toHaveProperty('presentation')
    expect(readSnapshot).not.toHaveBeenCalled()
    const older = await repo.readSessionMessageWindow({ sessionId: 's', limit: 50, cursor: model.window.older! })
    expect(older?.messages.map((row) => row.messageId)).toEqual(
      plain()
        .messages.slice(20, 70)
        .map((message) => message.id)
    )
    // @ts-expect-error A transcript window is never a complete session.
    const session: Session = model
    expect(session).toBe(model)
  })

  test('keeps legacy and interrupted promotion reads complete and read-only', async () => {
    const { repo, rows, records } = repository()
    await records.setRecord(plain())
    const recordRead = vi.spyOn(records, 'getRecord')
    expect((await repo.getSessionReadModel('s'))?.kind).toBe('full')
    expect(recordRead).toHaveBeenCalledTimes(1)
    expect(await rows.hasRows('s')).toBe(false)
    await repo.setSession(plain())
    await records.setRecord(plain())
    expect((await repo.getSessionReadModel('s'))?.kind).toBe('full')
    expect(await records.getRecord('s')).not.toHaveProperty('storageFormat')
  })

  test('falls back when the committed derived summary is absent', async () => {
    const { repo, rows } = repository()
    await repo.setSession(plain())
    const snapshot = (await rows.readSnapshot('s'))!
    delete snapshot.record.presentation
    await rows.writeRows({ ...snapshot, revision: snapshot.revision + 1 }, snapshot.revision)
    expect((await repo.getSessionReadModel('s'))?.kind).toBe('full')
  })

  test.each(['work', 'legacy-mode', 'archive', 'fork', 'paused', 'generating'] as const)(
    'preserves complete control data for %s',
    async (kind) => {
      const { repo, rows } = repository()
      const session = plain()
      if (kind === 'work') session.settings!.agentMode!.value = 'on'
      if (kind === 'legacy-mode') delete session.settings!.agentMode
      if (kind === 'archive')
        session.threads = [
          { id: 'old', name: 'Old', createdAt: 1, messages: [{ id: 'archived', role: 'user', contentParts: [] }] },
        ]
      if (kind === 'fork')
        session.messageForksHash = {
          m118: {
            position: 0,
            createdAt: 1,
            lists: [
              { id: 'selected', messages: [] },
              { id: 'other', messages: [{ id: 'off-path', role: 'assistant', contentParts: [], generating: true }] },
            ],
          },
        }
      if (kind === 'generating') session.messages[0].generating = true
      if (kind === 'paused')
        session.messages[1].contentParts = [
          {
            type: 'tool-call',
            toolCallId: 'pause',
            toolName: 'command',
            state: 'paused',
            pauseReason: { type: 'tool_call_limit', maxToolCalls: 25 },
          },
        ]
      await repo.setSession(session)
      const model = await repo.getSessionReadModel('s')
      expect(model?.kind).toBe('full')
      if (model?.kind !== 'full') throw new Error('expected complete controls')
      expect(model.revision).toBe((await rows.readSnapshot('s'))?.revision)
      expect(model.session.messages).toHaveLength(120)
      if (kind === 'fork') expect(model.session.messageForksHash?.m118.lists[1].messages[0].generating).toBe(true)
    }
  )

  test('rejects pagination after a write or deletion and recreation', async () => {
    const { repo } = repository()
    await repo.setSession(plain())
    const model = await repo.getSessionReadModel('s')
    if (model?.kind !== 'window') throw new Error('expected window')
    const current = (await repo.getSession('s'))!
    await repo.setSession({ ...current, name: 'changed' })
    await expect(
      repo.readSessionMessageWindow({ sessionId: 's', limit: 50, cursor: model.window.older! })
    ).rejects.toBeInstanceOf(SessionRowConflictError)
    await repo.deleteSession('s')
    expect(await repo.getSessionReadModel('s')).toBeNull()
    await repo.setSession(plain())
    await expect(
      repo.readSessionMessageWindow({ sessionId: 's', limit: 50, cursor: model.window.older! })
    ).rejects.toBeInstanceOf(SessionRowConflictError)
  })

  test('updates hinted summaries without scanning unchanged messages, and omits projections in V1 export', async () => {
    const { repo, rows } = repository()
    const session = plain()
    await repo.setSession(session)
    const snapshot = (await rows.readSnapshot('s'))!
    const before = session.messages.at(-1)!
    const after: Message = { ...before, generating: true }
    const next = { ...session, messages: [...session.messages.slice(0, -1), after] }
    const filter = vi.spyOn(next.messages, 'filter').mockImplementation(() => {
      throw new Error('full-history scan')
    })
    const record = deriveSessionRecord(next, 's', { record: snapshot.record, before, after })
    expect(record.presentation?.generatingMessageCount).toBe(1)
    expect(record.presentation?.userMessageCount).toBe(60)
    expect(filter).not.toHaveBeenCalled()
    filter.mockRestore()
    const decoded = decodeSessionTree({
      session: snapshot.record,
      threads: snapshot.rows.threads,
      messages: snapshot.rows.messages,
    })
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(decoded.session).not.toHaveProperty('presentation')
  })
})
