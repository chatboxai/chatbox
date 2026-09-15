import { describe, expect, test, vi } from 'vitest'
import { SessionWriteConflictError } from '../../ports'
import type { Message, Session } from '../../types'
import { createTestRecord, createTestSession, InMemorySessionRepository } from '../../testing/InMemorySessionRepository'
import { SessionMetadataUpdateError, SessionNotFoundError, SessionWriteCoordinator } from './SessionWriteCoordinator'

function message(id: string): Message {
  return {
    id,
    role: 'assistant',
    contentParts: [{ type: 'text', text: id }],
    generating: true,
  }
}

function pausedToolCallMessage(id: string): Message {
  return {
    id,
    role: 'assistant',
    generating: false,
    contentParts: [
      {
        type: 'tool-call',
        toolCallId: `${id}-tool`,
        toolName: 'user_exec',
        args: {},
        state: 'paused',
        pauseReason: { type: 'user_exec_approval', command: 'ls' },
      },
    ],
  }
}

function appendMessage(session: Session | null | undefined, messageId: string): Session {
  if (!session) throw new Error('Expected current session')
  return {
    ...session,
    messages: [...session.messages, message(messageId)],
  }
}

describe('SessionWriteCoordinator', () => {
  test('reprojectMeta repairs the metadata record from the retained snapshot', async () => {
    const repository = new InMemorySessionRepository()
    const session = createTestSession('session-1')
    repository.sessions.set(session.id, session)
    repository.records.set(session.id, createTestRecord(session, 1))
    const coordinator = new SessionWriteCoordinator(repository)
    vi.spyOn(repository.meta, 'update').mockRejectedValueOnce(new Error('metadata update failed'))

    await expect(
      coordinator.update(session.id, (current) => {
        if (!current) throw new Error('Expected current session')
        return { ...current, messages: [pausedToolCallMessage('reply-1')] }
      })
    ).rejects.toThrow('Failed to update metadata')
    expect(repository.records.get(session.id)?.hasPausedToolCall).not.toBe(true)

    const result = await coordinator.reprojectMeta(session.id)

    expect(result?.meta?.hasPausedToolCall).toBe(true)
    expect(repository.records.get(session.id)?.hasPausedToolCall).toBe(true)
  })

  test('limits backup replacement authority to the protected operation', async () => {
    const repository = new InMemorySessionRepository()
    const coordinator = new SessionWriteCoordinator(repository)
    const session = createTestSession('restored')
    let replace: ((session: Session) => Promise<void>) | undefined
    await coordinator.withBackupAccess(async (access) => {
      replace = access.replaceSession
      await access.replaceSession(session)
      await expect(coordinator.update(session.id, { name: 'Ordinary edit' })).rejects.toMatchObject({
        name: 'BackupOperationBusyError',
      })
    })
    await expect(replace?.({ ...session, name: 'Expired replacement' })).rejects.toThrow('expired')
    await coordinator.update(session.id, { name: 'Normal edit after restore' })
    expect((await repository.getSession(session.id))?.name).toBe('Normal edit after restore')
  })

  test('backup access drains accepted edits and rejects new edits and deletion until released', async () => {
    const repository = new InMemorySessionRepository()
    const original = createTestSession('backup-protected')
    await repository.setSession(original)
    const writes = new SessionWriteCoordinator(repository)
    const accepted = writes.update(original.id, { name: 'Before backup' }, { updateMeta: false })
    let finishBackup = () => {}
    const backup = new Promise<void>((resolve) => {
      finishBackup = resolve
    })
    let exportedName: string | undefined
    const operation = writes.withBackupAccess(async () => {
      exportedName = (await repository.getSession(original.id))?.name
      await backup
    })
    await expect(writes.update(original.id, { name: 'Late edit' })).rejects.toMatchObject({
      name: 'BackupOperationBusyError',
    })
    await expect(writes.delete(original.id, () => repository.deleteSession(original.id))).rejects.toMatchObject({
      name: 'BackupOperationBusyError',
    })
    await accepted
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(exportedName).toBe('Before backup')
    finishBackup()
    await operation
    await writes.update(original.id, { name: 'After backup' }, { updateMeta: false })
    expect((await repository.getSession(original.id))?.name).toBe('After backup')
  })

  test('restores backups after queued writes and primes subsequent edits from the restored value', async () => {
    const repository = new InMemorySessionRepository()
    const original = createTestSession('restore')
    repository.sessions.set(original.id, original)
    const coordinator = new SessionWriteCoordinator(repository)
    coordinator.prime(original)
    const queued = coordinator.update(original.id, (session) => appendMessage(session, 'queued'))
    const restored = { ...original, messages: [message('backup')] }
    await Promise.all([queued, coordinator.replaceFromBackup(restored)])
    await coordinator.update(original.id, (session) => appendMessage(session, 'after-restore'))
    expect(repository.sessions.get(original.id)?.messages.map(({ id }) => id)).toEqual(['backup', 'after-restore'])
    await coordinator.delete(original.id, async () => {
      repository.sessions.delete(original.id)
    })
    await coordinator.replaceFromBackup(restored)
    await coordinator.update(original.id, (session) => appendMessage(session, 'revived'))
    expect(repository.sessions.get(original.id)?.messages.map(({ id }) => id)).toEqual(['backup', 'revived'])
  })

  test('keeps the previous write baseline when backup persistence fails', async () => {
    const repository = new InMemorySessionRepository()
    const original = createTestSession('restore-failure')
    repository.sessions.set(original.id, original)
    const coordinator = new SessionWriteCoordinator(repository)
    coordinator.prime(original)
    vi.spyOn(repository, 'setSession').mockRejectedValueOnce(new Error('disk full'))
    await expect(coordinator.replaceFromBackup({ ...original, messages: [message('failed')] })).rejects.toThrow(
      'disk full'
    )
    await coordinator.update(original.id, (session) => appendMessage(session, 'surviving'))
    expect(repository.sessions.get(original.id)?.messages.map(({ id }) => id)).toEqual(['surviving'])
  })

  test('passes the changed message hint through to the repository write', async () => {
    const repository = new InMemorySessionRepository()
    const persisted = createTestSession('session-1')
    repository.sessions.set(persisted.id, persisted)
    const coordinator = new SessionWriteCoordinator(repository)

    const first = await coordinator.update(persisted.id, (session) => appendMessage(session, 'first'), {
      changedMessageId: 'first',
    })
    await coordinator.update(persisted.id, (session) => appendMessage(session, 'second'))

    expect(repository.writeOptions).toEqual([
      { changedMessageId: 'first', baseSession: persisted },
      { changedMessageId: undefined, baseSession: first.session },
    ])
  })

  test('starts from the injected read model and serializes concurrent writes', async () => {
    const repository = new InMemorySessionRepository()
    const persisted = createTestSession('session-1')
    const cached: Session = {
      ...persisted,
      messages: [message('streaming')],
    }
    repository.sessions.set(persisted.id, persisted)
    repository.records.set(persisted.id, createTestRecord(persisted, 1))
    const coordinator = new SessionWriteCoordinator(repository, {
      readCurrentSession: () => Promise.resolve(cached),
    })

    await Promise.all([
      coordinator.update(persisted.id, (session) => appendMessage(session, 'first')),
      coordinator.update(persisted.id, (session) => appendMessage(session, 'second')),
    ])

    expect(repository.sessions.get(persisted.id)?.messages.map(({ id }) => id)).toEqual([
      'streaming',
      'first',
      'second',
    ])
  })

  test('applies a read repair after already queued updates instead of overwriting them with its snapshot', async () => {
    const repository = new InMemorySessionRepository()
    const snapshot = createTestSession('session-1')
    repository.sessions.set(snapshot.id, snapshot)
    const coordinator = new SessionWriteCoordinator(repository)

    const ordinaryWrite = coordinator.update(snapshot.id, (session) => appendMessage(session, 'newer'))
    const repair = coordinator.updateFromSnapshot(snapshot, (session) => {
      if (!session) throw new Error('Expected current session')
      return { ...session, name: 'Repaired' }
    })

    await Promise.all([ordinaryWrite, repair])

    expect(repository.sessions.get(snapshot.id)).toMatchObject({ name: 'Repaired' })
    expect(repository.sessions.get(snapshot.id)?.messages.map(({ id }) => id)).toEqual(['newer'])
  })

  test('continues accepting writes after a rejected updater', async () => {
    const repository = new InMemorySessionRepository()
    const session = createTestSession('session-1')
    repository.sessions.set(session.id, session)
    repository.records.set(session.id, createTestRecord(session, 1))
    const coordinator = new SessionWriteCoordinator(repository)

    await expect(
      coordinator.update(session.id, () => {
        throw new Error('rejected')
      })
    ).rejects.toThrow('rejected')

    await coordinator.update(session.id, { name: 'Recovered' })
    expect(repository.sessions.get(session.id)?.name).toBe('Recovered')
  })

  test('discards retained and external snapshots after a write conflict', async () => {
    const repository = new InMemorySessionRepository()
    const session = createTestSession('session-1')
    repository.sessions.set(session.id, session)
    const discardCurrentSession = vi.fn()
    const originalSetSession = repository.setSession.bind(repository)
    vi.spyOn(repository, 'setSession')
      .mockRejectedValueOnce(new SessionWriteConflictError(session.id, 1, 2))
      .mockImplementation(originalSetSession)
    const coordinator = new SessionWriteCoordinator(repository, { discardCurrentSession })

    await expect(coordinator.update(session.id, { name: 'stale' })).rejects.toBeInstanceOf(SessionWriteConflictError)
    expect(discardCurrentSession).toHaveBeenCalledWith(session.id)

    repository.sessions.set(session.id, { ...session, name: 'fresh' })
    await expect(coordinator.update(session.id, { name: 'retry' })).resolves.toMatchObject({
      session: { name: 'retry' },
    })
  })

  test('projects hasPausedToolCall into the metadata and clears it when the pause resolves', async () => {
    const repository = new InMemorySessionRepository()
    const session = createTestSession('session-1')
    repository.sessions.set(session.id, session)
    repository.records.set(session.id, createTestRecord(session, 1))
    const coordinator = new SessionWriteCoordinator(repository)

    await coordinator.update(session.id, (current) => {
      if (!current) throw new Error('Expected current session')
      return { ...current, messages: [pausedToolCallMessage('reply-1')] }
    })
    expect(repository.records.get(session.id)?.hasPausedToolCall).toBe(true)

    await coordinator.update(session.id, (current) => {
      if (!current) throw new Error('Expected current session')
      return { ...current, messages: [message('reply-1')] }
    })
    expect(repository.records.get(session.id)?.hasPausedToolCall).toBe(false)
  })

  test('reports metadata failure after retaining the persisted session snapshot', async () => {
    const repository = new InMemorySessionRepository()
    const session = createTestSession('session-1')
    repository.sessions.set(session.id, session)
    repository.records.set(session.id, createTestRecord(session, 1))
    const coordinator = new SessionWriteCoordinator(repository)
    const metadataError = new Error('metadata update failed')
    vi.spyOn(repository.meta, 'update').mockRejectedValueOnce(metadataError)

    const failure = await coordinator
      .update(session.id, (current) => appendMessage(current, 'persisted'))
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(SessionMetadataUpdateError)
    expect(failure).toMatchObject({ metadataError, meta: { id: session.id, hasPausedToolCall: false } })
    expect(repository.sessions.get(session.id)?.messages.map(({ id }) => id)).toEqual(['persisted'])

    await coordinator.update(session.id, (current) => appendMessage(current, 'next'))
    expect(repository.sessions.get(session.id)?.messages.map(({ id }) => id)).toEqual(['persisted', 'next'])
  })

  test.each([true, false])(
    'recovery undo restores the full session after a queued write (updateMeta=%s)',
    async (updateMeta) => {
      const repository = new InMemorySessionRepository()
      const session = createTestSession('session-1')
      repository.sessions.set(session.id, session)
      repository.records.set(session.id, createTestRecord(session, 1))
      const coordinator = new SessionWriteCoordinator(repository)

      await coordinator.archiveMetadataOnly(session.id, 50)
      await coordinator.update(session.id, { name: 'Final generation write' }, { updateMeta })
      await coordinator.restoreMetadataOnly(session.id)
      await coordinator.update(session.id, { name: 'Next write' })

      expect(repository.sessions.get(session.id)).toMatchObject({ hidden: false })
      expect(repository.sessions.get(session.id)?.archivedAt).toBeUndefined()
      expect(repository.records.get(session.id)?.hidden).toBe(false)
      expect(repository.records.get(session.id)?.archivedAt).toBeUndefined()
    }
  )

  test('serializes metadata-only recovery archives and preserves them across later projections', async () => {
    const repository = new InMemorySessionRepository()
    const session = createTestSession('session-1')
    repository.sessions.set(session.id, session)
    repository.records.set(session.id, createTestRecord(session, 1))
    const coordinator = new SessionWriteCoordinator(repository)

    const pendingWrite = coordinator.update(session.id, { name: 'Written before archive' })
    const archive = coordinator.archiveMetadataOnly(session.id, 50)
    await Promise.all([pendingWrite, archive])

    expect(repository.records.get(session.id)).toMatchObject({
      hidden: true,
      archivedAt: 50,
      recoveryArchived: true,
    })

    await coordinator.reprojectMeta(session.id)
    expect(repository.records.get(session.id)?.recoveryArchived).toBe(true)

    await coordinator.update(session.id, { name: 'Written after archive' })
    expect(repository.sessions.get(session.id)).toMatchObject({ hidden: true, archivedAt: 50 })
    expect(repository.records.get(session.id)).toMatchObject({ hidden: true, archivedAt: 50 })
    expect(repository.records.get(session.id)?.recoveryArchived).toBeUndefined()
  })

  test('restores a metadata-only recovery archive before a later full write', async () => {
    const repository = new InMemorySessionRepository()
    const session = createTestSession('session-1')
    repository.sessions.set(session.id, session)
    repository.records.set(session.id, createTestRecord(session, 1))
    const coordinator = new SessionWriteCoordinator(repository)

    await coordinator.archiveMetadataOnly(session.id, 50)
    await coordinator.restoreMetadataOnly(session.id)
    await coordinator.update(session.id, { name: 'Written after restore' })

    expect(repository.sessions.get(session.id)).toMatchObject({ name: 'Written after restore' })
    expect(repository.sessions.get(session.id)?.hidden).not.toBe(true)
    expect(repository.records.get(session.id)).toMatchObject({ hidden: false })
    expect(repository.records.get(session.id)?.archivedAt).toBeUndefined()
    expect(repository.records.get(session.id)?.recoveryArchived).toBeUndefined()
  })

  test('loads a persisted recovery archive before the first write after restart', async () => {
    const repository = new InMemorySessionRepository()
    const session = createTestSession('session-1')
    repository.sessions.set(session.id, session)
    repository.records.set(session.id, {
      ...createTestRecord(session, 1),
      hidden: true,
      archivedAt: 50,
      recoveryArchived: true,
    })
    const coordinator = new SessionWriteCoordinator(repository)

    await coordinator.update(session.id, { name: 'Written after restart' })

    expect(repository.sessions.get(session.id)).toMatchObject({ hidden: true, archivedAt: 50 })
    expect(repository.records.get(session.id)?.recoveryArchived).toBeUndefined()
  })

  test('reports a failed accepted backup write even when its caller did not await it', async () => {
    const repository = new InMemorySessionRepository()
    const coordinator = new SessionWriteCoordinator(repository)
    const failure = new Error('disk full')
    vi.spyOn(repository, 'setSession').mockRejectedValueOnce(failure)
    await expect(
      coordinator.withBackupAccess(async (access) => {
        void access.replaceSession(createTestSession('backup')).catch(() => {})
      })
    ).rejects.toThrow('disk full')
    await expect(coordinator.replaceFromBackup(createTestSession('after'))).resolves.toBeUndefined()
  })

  test('reprojectMeta is a no-op without a snapshot or behind the deletion fence', async () => {
    const repository = new InMemorySessionRepository()
    const session = createTestSession('session-1')
    repository.sessions.set(session.id, session)
    repository.records.set(session.id, createTestRecord(session, 1))
    const coordinator = new SessionWriteCoordinator(repository)
    const metaUpdate = vi.spyOn(repository.meta, 'update')

    await expect(coordinator.reprojectMeta(session.id)).resolves.toBeNull()
    expect(metaUpdate).not.toHaveBeenCalled()

    await coordinator.update(session.id, (current) => appendMessage(current, 'persisted'))
    await coordinator.delete(session.id, () => Promise.resolve())
    metaUpdate.mockClear()

    await expect(coordinator.reprojectMeta(session.id)).resolves.toBeNull()
    expect(metaUpdate).not.toHaveBeenCalled()
  })

  test('drains queued writes before deletion and fences later writes from recreating the session', async () => {
    const repository = new InMemorySessionRepository()
    const session = createTestSession('session-1')
    repository.sessions.set(session.id, session)
    repository.records.set(session.id, createTestRecord(session, 1))
    const coordinator = new SessionWriteCoordinator(repository)
    let releaseWrite: () => void = () => undefined
    const writeBlocked = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    const originalSetSession = repository.setSession.bind(repository)
    let setStarted: () => void = () => undefined
    const setStartedPromise = new Promise<void>((resolve) => {
      setStarted = resolve
    })
    repository.setSession = async (updated) => {
      setStarted()
      await writeBlocked
      await originalSetSession(updated)
    }

    const pendingWrite = coordinator.update(session.id, { name: 'Updated before delete' })
    await setStartedPromise
    const deletion = coordinator.delete(session.id, () => repository.deleteSession(session.id))
    const lateWrite = coordinator.update(session.id, { name: 'Must not return' })

    await expect(lateWrite).rejects.toBeInstanceOf(SessionNotFoundError)
    expect(repository.sessions.has(session.id)).toBe(true)

    releaseWrite()
    await pendingWrite
    await deletion

    expect(repository.sessions.has(session.id)).toBe(false)
    await expect(coordinator.update(session.id, { name: 'Must not recreate' })).rejects.toBeInstanceOf(
      SessionNotFoundError
    )
    expect(repository.sessions.has(session.id)).toBe(false)
  })

  test('re-reads storage after a partially failed bulk deletion instead of reviving cached sessions', async () => {
    const repository = new InMemorySessionRepository()
    const removed = createTestSession('removed')
    const surviving = createTestSession('surviving')
    for (const session of [removed, surviving]) {
      repository.sessions.set(session.id, session)
      repository.records.set(session.id, createTestRecord(session, 1))
    }
    const coordinator = new SessionWriteCoordinator(repository)

    // Prime both coordinator snapshots before the partial deletion.
    await coordinator.update(removed.id, { name: 'Cached removed' })
    await coordinator.update(surviving.id, { name: 'Cached surviving' })

    await expect(
      coordinator.deleteMany([removed.id, surviving.id], async () => {
        await repository.deleteSession(removed.id)
        throw new Error('bulk deletion failed')
      })
    ).rejects.toThrow('bulk deletion failed')

    await expect(coordinator.update(removed.id, { name: 'Must not revive' })).rejects.toBeInstanceOf(
      SessionNotFoundError
    )
    await coordinator.update(surviving.id, { name: 'Recovered from storage' })

    expect(repository.sessions.has(removed.id)).toBe(false)
    expect(repository.sessions.get(surviving.id)?.name).toBe('Recovered from storage')
  })
})
