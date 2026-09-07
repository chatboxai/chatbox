import { describe, expect, test, vi } from 'vitest'
import type { Message, Session } from '../../types'
import { createTestRecord, createTestSession, MemorySessionRepository } from './__tests__/memory-session-repository'
import { SessionMetadataUpdateError, SessionNotFoundError, SessionWriteCoordinator } from './SessionWriteCoordinator'

function message(id: string): Message {
  return {
    id,
    role: 'assistant',
    contentParts: [{ type: 'text', text: id }],
    generating: true,
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
  test('starts from the injected read model and serializes concurrent writes', async () => {
    const repository = new MemorySessionRepository()
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
    const repository = new MemorySessionRepository()
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
    const repository = new MemorySessionRepository()
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

  test('reports metadata failure after retaining the persisted session snapshot', async () => {
    const repository = new MemorySessionRepository()
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
    expect(failure).toMatchObject({ metadataError })
    expect(repository.sessions.get(session.id)?.messages.map(({ id }) => id)).toEqual(['persisted'])

    await coordinator.update(session.id, (current) => appendMessage(current, 'next'))
    expect(repository.sessions.get(session.id)?.messages.map(({ id }) => id)).toEqual(['persisted', 'next'])
  })

  test('drains queued writes before deletion and fences later writes from recreating the session', async () => {
    const repository = new MemorySessionRepository()
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
    const repository = new MemorySessionRepository()
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
