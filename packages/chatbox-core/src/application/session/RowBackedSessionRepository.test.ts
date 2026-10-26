import { describe, expect, it, vi } from 'vitest'
import { SESSION_TEXT_TOKEN_VERSION, type SessionTextTokenResult } from '../../ports/session-text-tokens'
import { SessionWriteConflictError } from '../../ports/session-repository'
import { SessionRowConflictError } from '../../ports/session-row-store'
import { InMemorySessionRecordStore } from '../../testing/InMemorySessionRecordStore'
import { InMemorySessionRowStore } from '../../testing/InMemorySessionRowStore'
import type { Message, SessionHeader } from '../../types'
import { RowBackedSessionRepository } from './RowBackedSessionRepository'
import { SessionRowWriteQueue } from './SessionRowWriteQueue'

const message = (id: string, role: Message['role'] = 'user'): Message => ({
  id,
  role,
  contentParts: [{ type: 'text', text: id }],
  timestamp: 1,
})
function setup() {
  const records = new InMemorySessionRecordStore()
  const rows = new InMemorySessionRowStore()
  const writes = new SessionRowWriteQueue((_id, operation) => operation())
  const repository = new RowBackedSessionRepository({ records, rows, writes })
  return { records, rows, writes, repository }
}

function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('row-only session repository', () => {
  it('creates an independent header and a committed selected row path', async () => {
    const { repository, records } = setup()
    const result = await repository.createSessionRows({ id: 's', name: 'Rows' }, [
      message('system', 'system'),
      message('user'),
    ])
    expect(result).toMatchObject({ previousRevision: null, revision: 1, appendedMessageIds: ['system', 'user'] })
    expect(result).not.toHaveProperty('previousHeader')
    expect(await repository.getSessionHeader('s')).toMatchObject({
      revision: 1,
      activeThreadId: 's',
      summary: { messageCount: 2, firstSystemMessageId: 'system', lastUserMessageId: 'user' },
    })
    expect(await records.getRecord('s')).toBeNull()
  })

  it('reads only four naming bodies after screening system rows as metadata', async () => {
    const { repository, rows } = setup()
    const values = Array.from({ length: 205 }, (_, index) => message(`system-${index}`, 'system'))
    values.push(...Array.from({ length: 8 }, (_, index) => message(`turn-${index}`, index % 2 ? 'assistant' : 'user')))
    await repository.createSessionRows({ id: 's', name: 'Rows' }, values)
    const read = vi.spyOn(rows, 'readMessages')
    const result = await repository.readSessionNamingMessages({ sessionId: 's', expectedRevision: 1 })
    expect(result?.messages.map((message) => message.id)).toEqual(['turn-0', 'turn-1', 'turn-2', 'turn-3'])
    expect(read).toHaveBeenCalledOnce()
    expect(read.mock.calls[0][0].messageIds).toHaveLength(4)
  })

  it.each(['generation control', 'naming'] as const)(
    'reports a %s read revision conflict after an interleaving commit',
    async (kind) => {
      const { repository } = setup()
      await repository.createSessionRows({ id: 's', name: 'Rows' }, [message('reply', 'assistant')])
      const point = await repository.readSessionMessages({ sessionId: 's', messageIds: ['reply'] })
      if (!point || point.revision === null) throw new Error('Missing committed point read')
      await repository.executeSessionCommand('s', { type: 'header', updater: { id: 's', name: 'Renamed' } })
      const read =
        kind === 'generation control'
          ? repository.readSessionGenerationControl({
              sessionId: 's',
              activeGenerationMessageIds: ['reply'],
              expectedRevision: point.revision,
            })
          : repository.readSessionNamingMessages({ sessionId: 's', expectedRevision: point.revision })
      await expect(read).rejects.toBeInstanceOf(SessionRowConflictError)
      await expect(read).rejects.toMatchObject({ sessionId: 's', expectedRevision: 1, actualRevision: 2 })
    }
  )

  it('keeps numerical token results outside point-read message content', async () => {
    const { repository, rows } = setup()
    await repository.createSessionRows({ id: 's', name: 'Rows' }, [message('first')])
    const request = { sessionId: 's', messageIds: ['first'] }
    const read = (await rows.readMessages(request))!
    const result: SessionTextTokenResult = {
      source: {
        sessionId: 's',
        messageId: 'first',
        payloadId: 'payload',
        calculationVersion: SESSION_TEXT_TOKEN_VERSION,
        textDigest: 'digest',
        text: 'first',
      },
      value: { tokenizerType: 'default', tokens: 25, calculatedAt: 1, sourceDigest: 'digest' },
    }
    vi.spyOn(rows, 'readMessages').mockResolvedValue({
      ...read,
      textTokens: { sources: { first: result.source }, results: [result] },
    })
    const point = await repository.readSessionMessages(request)
    expect(point?.messages).toEqual([message('first')])
    expect(point).not.toHaveProperty('textTokens')
  })

  it('publishes the new retry chain and authoritative branch metadata in the command result', async () => {
    const { repository, rows } = setup()
    await repository.createSessionRows({ id: 's', name: 'Rows' }, [message('pivot'), message('old', 'assistant')])
    const readTranscript = vi.spyOn(rows, 'readTranscriptWindow')
    const reply = { ...message('new', 'assistant'), generating: true }
    const result = await repository.executeSessionCommand('s', {
      type: 'structure',
      operation: {
        action: 'message-retry',
        messageId: 'old',
        reply,
        identity: { seedListId: 'seed', storedListId: 'original', newListId: 'alternative', createdAt: 42 },
      },
    })
    expect(result.delta).toMatchObject({
      previousRevision: 1,
      revision: 2,
      appendedMessageIds: ['new'],
      structureResult: {
        applied: true,
        replyMessageId: 'new',
        navigation: {
          type: 'branch',
          mode: 'create',
          sharedPrefixEnd: { threadId: 's', messageId: 'pivot' },
          firstMessageId: 'new',
        },
      },
    })
    expect(result.delta.diff.messages.upsert).toHaveLength(1)
    expect(result.delta.diff.messages.upsert[0]).toMatchObject({
      messageId: 'new',
      parentMessageId: 'pivot',
      activeChildId: null,
      selected: true,
      message: reply,
    })
    expect(result.delta.diff.threads.upsert.find((thread) => thread.threadId === 's')).toMatchObject({
      rootMessageId: 'pivot',
      activeLeafMessageId: 'new',
    })
    expect(result.delta.diff.messageMetadataUpsert?.find((row) => row.messageId === 'pivot')).toMatchObject({
      activeChildId: 'new',
    })
    expect(readTranscript).not.toHaveBeenCalled()
  })

  it('resolves inactive generation ownership through revision-fenced ancestry pages', async () => {
    const { repository, rows } = setup()
    const replies = Array.from({ length: 205 }, (_, index) => message(`reply-${index}`, 'assistant'))
    replies[204].generating = true
    await repository.createSessionRows({ id: 's', name: 'Rows' }, [message('pivot'), ...replies])
    await repository.executeSessionCommand('s', {
      type: 'structure',
      operation: {
        action: 'fork-create',
        pivotId: 'pivot',
        identity: { seedListId: 'seed', storedListId: 'original', newListId: 'alternative', createdAt: 42 },
        append: [message('alternative', 'assistant')],
      },
    })
    const relations = vi.spyOn(rows, 'readMessageRelationsPage')
    const points = vi.spyOn(rows, 'readMessageMetadata')
    const control = await repository.readSessionGenerationControl({
      sessionId: 's',
      activeGenerationMessageIds: ['reply-204'],
      expectedRevision: 2,
    })
    expect(control?.cancellableMessages).toEqual([
      { messageId: 'reply-204', threadId: 's', branchId: 'fork_list_original', forkPivotId: 'pivot' },
    ])
    expect(relations).toHaveBeenCalledTimes(2)
    for (const [request] of relations.mock.calls)
      expect(request).toMatchObject({
        selector: { kind: 'ancestors', messageId: 'reply-204' },
        limit: 200,
        expectedRevision: 2,
      })
    expect(points.mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('updates and appends without reading complete rows or a thread suffix', async () => {
    const { repository, rows } = setup()
    await repository.createSessionRows({ id: 's', name: 'Rows' }, [message('first')])
    vi.spyOn(rows, 'readSnapshot').mockRejectedValue(new Error('Complete reads are forbidden'))
    const append = await repository.executeSessionCommand('s', {
      type: 'append',
      messages: [message('reply', 'assistant')],
    })
    expect(append.delta).toMatchObject({ previousRevision: 1, revision: 2, appendedMessageIds: ['reply'] })
    expect(append.delta.diff.messages.upsert.map((row) => row.messageId)).toEqual(['reply'])
    const update = await repository.executeSessionCommand('s', {
      type: 'update',
      messageId: 'first',
      updater: { contentParts: [{ type: 'text', text: 'Edited' }] },
    })
    expect(update.delta.diff.messages.upsert.map((row) => row.messageId)).toEqual(['first'])
    expect(await repository.getSessionHeader('s')).toMatchObject({ summary: { messageCount: 2 } })
  })

  it('cancels only live identities in the cleared thread scope', async () => {
    const { repository } = setup()
    await repository.createSessionRows({ id: 's', name: 'Rows' }, [
      { ...message('old-live', 'assistant'), generating: true },
    ])
    await repository.executeSessionCommand('s', {
      type: 'structure',
      operation: {
        action: 'thread-create',
        archiveId: 'new-thread',
        now: 2,
        systemMessageId: 'system',
        defaultSystemPrompt: 'Prompt',
      },
    })
    await repository.executeSessionCommand('s', {
      type: 'append',
      messages: [{ ...message('current-live', 'assistant'), generating: true }],
    })
    const result = await repository.executeSessionCommand('s', {
      type: 'structure',
      operation: {
        action: 'session-clear',
        scope: 'active',
        activeGenerationMessageIds: ['old-live', 'current-live'],
      },
    })
    expect(result.delta.structureResult?.cancelMessageIds).toEqual(['current-live'])
    expect(
      (await repository.readSessionMessages({ sessionId: 's', messageIds: ['old-live'] }))?.messages[0].generating
    ).toBe(true)
  })

  it('checks the exact caller revision before evaluating an updater', async () => {
    const { repository } = setup()
    await repository.createSessionRows({ id: 's', name: 'Rows' }, [])
    const updater = vi.fn((header: SessionHeader | null | undefined) => ({ ...header, id: 's', name: 'Stale' }))
    await expect(repository.executeSessionCommand('s', { type: 'header', updater }, 0)).rejects.toBeInstanceOf(
      SessionWriteConflictError
    )
    expect(updater).not.toHaveBeenCalled()
    expect((await repository.getSessionHeader('s'))?.header.name).toBe('Rows')
  })

  it('serializes read-modify-write commands across repositories sharing one owner', async () => {
    const { repository, records, rows, writes } = setup()
    const other = new RowBackedSessionRepository({ records, rows, writes })
    await repository.createSessionRows({ id: 's', name: '0' }, [])
    await Promise.all(
      [repository, other, repository, other].map((repo) =>
        repo.executeSessionCommand('s', {
          type: 'header',
          updater: (header) => {
            if (!header) throw new Error('Missing header')
            return { ...header, name: String(Number(header.name) + 1) }
          },
        })
      )
    )
    expect(await repository.getSessionHeader('s')).toMatchObject({ revision: 5, header: { name: '4' } })
  })

  it('keeps a migrated whole-session record unchanged across commits and removes it on deletion', async () => {
    const { repository, records } = setup()
    const legacy = { id: 's', name: 'Before upgrade', type: 'chat' as const, messages: [message('first')] }
    await records.setRecord(legacy)
    const setRecord = vi.spyOn(records, 'setRecord')
    await repository.executeSessionCommand('s', { type: 'append', messages: [message('second')] })
    await repository.executeSessionCommand('s', { type: 'header', updater: { name: 'Latest' } })
    expect((await repository.getSessionHeader('s'))?.header.name).toBe('Latest')
    expect(setRecord).not.toHaveBeenCalled()
    expect(await records.getRecord('s')).toEqual(legacy)
    await repository.deleteSession('s')
    expect(await records.getRecord('s')).toBeNull()
    expect(await repository.getAllSessionIds()).toEqual([])
  })

  it('serializes external projection callbacks with deletion and reads latest state', async () => {
    const { repository, records } = setup()
    await repository.createSessionRows({ id: 's', name: 'Rows' }, [])
    const started = deferred()
    const release = deferred()
    const events: string[] = []
    const projection = repository.projectLatestSession('s', async (current) => {
      events.push(current!.header.name)
      started.resolve()
      await release.promise
    })
    await started.promise
    const deletion = repository.deleteSession('s').then(() => events.push('deleted'))
    release.resolve()
    await Promise.all([projection, deletion])
    await repository.projectLatestSession('s', async (current) => {
      expect(current).toBeNull()
      events.push('missing')
    })
    expect(events).toEqual(['Rows', 'deleted', 'missing'])
    expect(await records.getRecord('s')).toBeNull()
  })

  it('continues the shared queue after a projection callback fails', async () => {
    const { repository } = setup()
    await repository.createSessionRows({ id: 's', name: 'Rows' }, [])
    await expect(
      repository.projectLatestSession('s', async () => {
        throw new Error('List unavailable')
      })
    ).rejects.toThrow('List unavailable')
    await repository.executeSessionCommand('s', { type: 'header', updater: { name: 'Renamed' } })
    expect((await repository.getSessionHeader('s'))?.header.name).toBe('Renamed')
  })

  it('never publishes storage metadata in header reads', async () => {
    const { repository } = setup()
    await repository.createSessionRows({ id: 's', name: 'Rows' }, [])
    const header = (await repository.getSessionHeader('s'))!.header
    for (const key of ['rowFormatVersion', 'rowAuthority', 'activeThreadId', 'storageFormat'])
      expect(header).not.toHaveProperty(key)
  })
  it('serializes metadata-only recovery without reading or migrating content', async () => {
    const { repository, records, rows } = setup()
    vi.spyOn(records, 'getRecord').mockRejectedValue(new Error('Legacy content is unreadable'))
    vi.spyOn(rows, 'readCommit').mockRejectedValue(new Error('Rows are unreadable'))
    await expect(repository.projectSessionMetadata('unreadable', async () => 42)).resolves.toBe(42)
    expect(records.getRecord).not.toHaveBeenCalled()
    expect(rows.readCommit).not.toHaveBeenCalled()
  })

  it('holds the deletion owner until its metadata callback completes', async () => {
    const { repository, records } = setup()
    await repository.createSessionRows({ id: 's', name: 'Before' }, [])
    const started = deferred()
    const release = deferred()
    const events: string[] = []
    const deletion = repository.deleteSession('s', async () => {
      started.resolve()
      await release.promise
      events.push('old-meta-deleted')
    })
    await started.promise
    const creation = repository.createSessionRows({ id: 's', name: 'After' }, []).then(() => events.push('created'))
    release.resolve()
    await Promise.all([deletion, creation])
    expect(events).toEqual(['old-meta-deleted', 'created'])
    expect(await records.getRecord('s')).toBeNull()
    expect((await repository.getSessionHeader('s'))?.header.name).toBe('After')
  })
})
