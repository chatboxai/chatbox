import { InMemorySessionRepository } from '@chatbox/core/testing'
import type { SessionRepositoryPort } from '@chatbox/core/ports'
import type { Session } from '@shared/types'

/** Imports mutable test fixtures at the storage boundary and exposes production row reads. */
export function createRowSessionFixtureReads(readFixture: (sessionId: string) => Promise<Session | null | undefined>) {
  const repository = new InMemorySessionRepository()
  const versions = new Map<string, string>()
  let tail = Promise.resolve()
  function read<T>(sessionId: string, operation: () => Promise<T>): Promise<T | null> {
    const result = tail.then(async () => {
      const fixture = await readFixture(sessionId)
      if (!fixture) return null
      const version = JSON.stringify(fixture)
      if (versions.get(sessionId) !== version) {
        await repository.seedSession(fixture)
        versions.set(sessionId, version)
      }
      return operation()
    })
    tail = result.then(
      () => {},
      () => {}
    )
    return result
  }
  return {
    repository,
    getSessionHeader: (sessionId: string) => read(sessionId, () => repository.getSessionHeader(sessionId)),
    readSessionConversationState: (request: Parameters<SessionRepositoryPort['readSessionConversationState']>[0]) =>
      read(request.sessionId, () => repository.readSessionConversationState(request)),
    readSessionGenerationControl: (request: Parameters<SessionRepositoryPort['readSessionGenerationControl']>[0]) =>
      read(request.sessionId, () => repository.readSessionGenerationControl(request)),
    readSessionThreadSummariesPage: (request: Parameters<SessionRepositoryPort['readSessionThreadSummariesPage']>[0]) =>
      read(request.sessionId, () => repository.readSessionThreadSummariesPage(request)),
    readSessionMessages: (request: Parameters<SessionRepositoryPort['readSessionMessages']>[0]) =>
      read(request.sessionId, () => repository.readSessionMessages(request)),
  }
}
