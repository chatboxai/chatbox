import { SessionRowWriteQueue } from './SessionRowWriteQueue'
import { describe, expect, test, vi } from 'vitest'
import type { SessionCommand, SessionCommandDelta, SessionHeaderRead, SessionRepositoryPort } from '../../ports'
import type { SessionHeader } from '../../types'
import { emptyThreadSummary } from '../../session/message-facts'
import { InMemorySessionRepository } from '../../testing/InMemorySessionRepository'
import { SessionNotFoundError, SessionWriteCoordinator } from './SessionWriteCoordinator'

function fixture() {
  const metadata = new InMemorySessionRepository()
  const owner = new SessionRowWriteQueue((_id, action) => action())
  let read: SessionHeaderRead | null = {
    header: { id: 's', name: 'Title', type: 'chat' },
    revision: 1,
    activeThreadId: 't',
    summary: emptyThreadSummary(),
    control: { generatingAssistantCount: 0 },
  }
  const calls: SessionCommand[] = []
  const unavailable = async (): Promise<never> => {
    throw new Error('Unexpected body read')
  }
  const repository: SessionRepositoryPort = {
    ...metadata,
    meta: metadata.meta,
    initialize: async () => {},
    getSessionHeader: async () => read,
    getCurrentThreadIdentity: unavailable,
    readSessionGenerationControl: unavailable,
    createSessionTokenPlan: unavailable,
    readSessionTokenPage: unavailable,
    projectLatestSession: (id, project) => owner.run(id, () => project(read)),
    projectSessionMetadata: (id, project) => owner.run(id, project),
    readSessionTranscriptWindow: unavailable,
    readSessionThread: unavailable,
    readSessionThreadSummariesPage: unavailable,
    readSessionForkOptionsPage: unavailable,
    readSessionMessages: unavailable,
    getSessionContextSource: unavailable,
    patchSessionMessageDerivedData: async (sessionId, patches) => ({
      sessionId,
      patches,
      previousRevision: 1,
      revision: 2,
    }),
    acceptSessionTextTokenResults: async (sessionId, results) => ({ sessionId, results: [...results] }),
    createSessionRows: unavailable,
    executeSessionCommand: async (_id, command) => {
      if (!read) throw new SessionNotFoundError('s')
      calls.push(command)
      const previous = read
      const header =
        command.type === 'header'
          ? {
              ...read.header,
              ...(typeof command.updater === 'function' ? command.updater(read.header) : command.updater),
            }
          : read.header
      read = { ...read, header, revision: read.revision + 1 }
      const delta: SessionCommandDelta = {
        sessionId: 's',
        header,
        previousHeader: previous.header,
        record: { ...header, storageFormat: 'rows', rowFormatVersion: 3, rowAuthority: 1, activeThreadId: 't' },
        revision: read.revision,
        previousRevision: previous.revision,
        diff: { sessionId: 's', threads: { upsert: [], delete: [] }, messages: { upsert: [], delete: [] } },
        appendedMessageIds: [],
      }
      return { kind: 'rows', delta }
    },
    deleteSession: (id, project) =>
      owner.run(id, async () => {
        read = null
        await project?.()
      }),
    getAllSessionIds: async () => (read ? ['s'] : []),
  }
  const writes = new SessionWriteCoordinator(repository)
  return {
    repository,
    writes,
    metadata,
    calls,
    setRead: (value: SessionHeaderRead | null) => {
      read = value
    },
    current: () => read!,
  }
}

describe('row write coordinator', () => {
  test('projects the latest header revision, including a newer externally committed write', async () => {
    const f = fixture()
    const project = f.repository.projectLatestSession
    f.repository.projectLatestSession = async (id, callback) => {
      f.setRead({ ...f.current(), header: { ...f.current().header, name: 'Latest' }, revision: 8 })
      return project(id, callback)
    }
    const result = await f.writes.executeCommand('s', { type: 'header', updater: { name: 'Local' } })
    expect(result.delta.revision).toBe(2)
    expect(result.metaRevision).toBe(8)
    expect(result.meta?.name).toBe('Latest')
  })

  test('metadata failure preserves the durable delta and repairs without replaying the command', async () => {
    const f = fixture()
    vi.spyOn(f.repository.meta, 'create').mockRejectedValueOnce(new Error('meta offline'))
    const result = await f.writes.executeCommand('s', {
      type: 'append',
      messages: [{ id: 'm', role: 'user', contentParts: [] }],
    })
    expect(result.delta.revision).toBe(2)
    expect(result.projectionError).toBeInstanceOf(Error)
    await f.writes.reprojectMeta('s')
    expect(f.calls).toHaveLength(1)
    expect(f.metadata.records.has('s')).toBe(true)
  })

  test('preserves recovery archives until explicit restore and remembers a failed restore projection', async () => {
    const f = fixture()
    await f.metadata.meta.create({
      id: 's',
      name: 'Title',
      sortOrder: 1,
      createdAt: 1,
      hidden: true,
      archivedAt: 7,
      recoveryArchived: true,
    })
    await f.writes.executeCommand('s', { type: 'header', updater: { name: 'Renamed' } })
    expect(f.metadata.records.get('s')).toMatchObject({ hidden: true, archivedAt: 7, recoveryArchived: true })
    vi.spyOn(f.repository.meta, 'update').mockRejectedValueOnce(new Error('meta offline'))
    const result = await f.writes.executeCommand(
      's',
      { type: 'header', updater: { hidden: false, archivedAt: undefined } },
      { clearRecoveryArchive: true }
    )
    expect(result.projectionError).toBeInstanceOf(Error)
    await f.writes.reprojectMeta('s')
    expect(f.metadata.records.get('s')).toMatchObject({ hidden: false, recoveryArchived: undefined })
  })

  test('a committed deletion fences late commands and metadata repairs', async () => {
    const f = fixture()
    const accepted = f.writes.executeCommand('s', { type: 'header', updater: { name: 'Before delete' } })
    const deletion = f.writes.delete('s', async () => {
      await f.repository.deleteSession('s')
      await f.repository.meta.delete('s')
    })
    await expect(f.writes.executeCommand('s', { type: 'append', messages: [] })).rejects.toBeInstanceOf(
      SessionNotFoundError
    )
    await Promise.all([accepted, deletion])
    expect(await f.writes.reprojectMeta('s')).toBeNull()
    expect(f.metadata.records.has('s')).toBe(false)
  })

  test('a failed deletion reopens writes without retaining a body snapshot', async () => {
    const f = fixture()
    await expect(
      f.writes.delete('s', async () => {
        throw new Error('locked')
      })
    ).rejects.toThrow('locked')
    await f.writes.executeCommand('s', { type: 'header', updater: { name: 'Recovered' } })
    expect(f.current().header.name).toBe('Recovered')
  })

  test('exclusive operation drains accepted commands and blocks new writes and deletion', async () => {
    const f = fixture()
    let release = () => {}
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const accepted = f.writes.executeCommand('s', { type: 'header', updater: { name: 'Before exclusive operation' } })
    const operation = f.writes.withExclusiveAccess(async () => {
      expect(f.current().header.name).toBe('Before exclusive operation')
      await barrier
    })
    await expect(f.writes.executeCommand('s', { type: 'append', messages: [] })).rejects.toMatchObject({
      name: 'SessionStorageBusyError',
    })
    await expect(f.writes.delete('s', async () => {})).rejects.toMatchObject({ name: 'SessionStorageBusyError' })
    await accepted
    release()
    await operation
    await f.writes.executeCommand('s', { type: 'header', updater: { name: 'After exclusive operation' } })
  })

  test.each(['archive', 'restore'] as const)(
    'metadata-only %s shares the owner with projections from another coordinator',
    async (operation) => {
      const f = fixture()
      await f.metadata.meta.create({
        id: 's',
        name: 'Title',
        sortOrder: 1,
        createdAt: 1,
        ...(operation === 'restore' ? { hidden: true, archivedAt: 7, recoveryArchived: true } : {}),
      })
      let release = () => {}
      let entered = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const started = new Promise<void>((resolve) => {
        entered = resolve
      })
      const update = f.repository.meta.update
      vi.spyOn(f.repository.meta, 'update').mockImplementationOnce(async (id, patch) => {
        entered()
        await gate
        return update(id, patch)
      })
      const pending = f.writes.executeCommand('s', { type: 'header', updater: { name: 'Changed' } })
      await started
      const other = new SessionWriteCoordinator(f.repository)
      const recovery = operation === 'archive' ? other.archiveMetadataOnly('s', 99) : other.restoreMetadataOnly('s')
      release()
      await Promise.all([pending, recovery])
      expect(f.metadata.records.get('s')?.hidden).toBe(operation === 'archive')
    }
  )

  test('token side-cache writes do not project a header or issue a content command', async () => {
    const f = fixture()
    const project = vi.spyOn(f.repository, 'projectLatestSession')
    await f.writes.acceptTextTokenResults('s', [])
    expect(project).not.toHaveBeenCalled()
    expect(f.calls).toHaveLength(0)
  })

  test('creation metadata failure retains ordering for an independent repair', async () => {
    const f = fixture()
    const header: SessionHeader = { id: 's', name: 'Created', type: 'chat' }
    f.repository.createSessionRows = async () => {
      const result = await f.repository.executeSessionCommand('s', { type: 'header', updater: header })
      return { ...result.delta, previousRevision: null, previousHeader: undefined }
    }
    vi.spyOn(f.repository.meta, 'create').mockRejectedValueOnce(new Error('meta offline'))
    const created = await f.writes.create(header, [], 123, 456)
    expect(created.delta.previousRevision).toBeNull()
    expect(created.projectionError).toBeInstanceOf(Error)
    await f.writes.reprojectMeta('s')
    expect(f.metadata.records.get('s')).toMatchObject({ sortOrder: 123, createdAt: 456 })
  })
})
