import { describe, expect, test, vi } from 'vitest'
import type { SessionFolderStorePort } from '../../ports'
import { InMemorySessionRepository } from '../../testing/InMemorySessionRepository'
import { type Session, type SessionFolder, SessionFolderSchema } from '../../types'
import { SessionService } from './SessionService'
import { SessionWriteCoordinator } from './SessionWriteCoordinator'
import { SessionEventBus } from './session-events'

function harness(initial: SessionFolder[] = [], failSave = false, enabled = true) {
  const repository = new InMemorySessionRepository()
  const store: SessionFolderStorePort = {
    load: async () => initial,
    save: () => (failSave ? Promise.reject(new Error('Disk unavailable')) : Promise.resolve()),
  }
  const getCopilotName = vi.fn(
    async (copilotId: string): Promise<string | undefined> =>
      ['writer', 'other-writer'].includes(copilotId) ? 'Writing partner' : undefined
  )
  let id = 0
  const service = new SessionService(repository, new SessionWriteCoordinator(repository), new SessionEventBus(), {
    createId: () => `id-${++id}`,
    folders: enabled ? store : undefined,
    getCopilotName,
  })
  return { service, repository, getCopilotName }
}

const copilot = { name: 'Writing partner', copilotId: 'writer', messages: [] }
const workSettings: Session['settings'] = {
  agentMode: { value: 'on', locked: false, lockReason: null },
  workingDirectories: ['/work/app'],
}

describe('copilot folders', () => {
  test('concurrent conversations share one folder and persist their membership', async () => {
    const { service, repository } = harness()
    const sessions = await Promise.all([service.createSession(copilot), service.createSession(copilot)])
    const folders = await service.listSessionFolders()
    expect(folders).toEqual([{ id: expect.any(String), name: copilot.name, copilotId: 'writer' }])
    for (const session of sessions) {
      expect(session.folderId).toBe(folders[0].id)
      expect((await repository.getSessionHeader(session.id))?.header.folderId).toBe(folders[0].id)
    }
    expect((await service.listAllSessionsMeta()).every((item) => item.folderId === folders[0].id)).toBe(true)
  })

  test('identity distinguishes same-name copilots and manual folders', async () => {
    const { service } = harness([{ id: 'manual', name: copilot.name }])
    const first = await service.createSession(copilot)
    const second = await service.createSession({ ...copilot, copilotId: 'other-writer' })
    expect(first.folderId).not.toBe('manual')
    expect(second.folderId).not.toBe(first.folderId)
    expect(await service.listSessionFolders()).toHaveLength(3)
  })

  test('reuses renamed folders without changing their names', async () => {
    const { service } = harness([{ id: 'custom', name: 'My writing', copilotId: 'writer' }])
    expect((await service.createSession(copilot)).folderId).toBe('custom')
    expect(await service.listSessionFolders()).toEqual([{ id: 'custom', name: 'My writing', copilotId: 'writer' }])
  })

  test('preserves explicit folders, manual moves, and moving out', async () => {
    const { service } = harness([{ id: 'manual', name: 'Manual' }])
    expect((await service.createSession({ ...copilot, folderId: 'manual' })).folderId).toBe('manual')
    const session = await service.createSession(copilot)
    await service.moveSessionToFolder(session.id, 'manual')
    expect((await service.updateSessionHeader(session.id, { name: 'Renamed chat' })).folderId).toBe('manual')
    await service.moveSessionToFolder(session.id, undefined)
    expect((await service.updateSessionHeader(session.id, { name: 'Unfiled chat' })).folderId).toBeUndefined()
  })

  test('files conversations with stale folder references and recreates deleted folders', async () => {
    const { service } = harness()
    const first = await service.createSession({ ...copilot, folderId: 'missing' })
    expect(first.folderId).toBeTruthy()
    await service.saveSessionFolders([])
    const second = await service.createSession(copilot)
    expect(second.folderId).toBeTruthy()
    expect(second.folderId).not.toBe(first.folderId)
  })

  test('working directories take priority both at creation and when enabled later', async () => {
    const { service } = harness()
    const work = await service.createSession({ ...copilot, settings: workSettings })
    expect(await service.listSessionFolders()).toEqual([
      { id: work.folderId, name: 'app', workingDirectory: '/work/app' },
    ])
    const chat = await service.createSession(copilot)
    expect(chat.folderId).not.toBe(work.folderId)
    expect((await service.updateSessionHeader(chat.id, { settings: workSettings })).folderId).toBe(work.folderId)
  })

  test('ordinary chats and hosts without folder storage stay unfiled', async () => {
    const { service } = harness()
    expect((await service.createSession({ name: 'Chat', messages: [] })).folderId).toBeUndefined()
    expect(await service.listSessionFolders()).toEqual([])
    expect((await harness([], false, false).service.createSession(copilot)).folderId).toBeUndefined()
  })

  test('folder write failures do not block conversation creation', async () => {
    const { service } = harness([], true)
    const session = await service.createSession(copilot)
    expect(session.id).toBeTruthy()
    expect(session.folderId).toBeUndefined()
  })

  test('uses the saved copilot name for copied and promoted conversations with their own titles', async () => {
    const { service, getCopilotName } = harness()
    const promoted = await service.createSession({
      ...copilot,
      name: 'Weekly report draft',
      threadName: 'Weekly report draft',
    })
    const copied = await service.createSession({ ...copilot, name: 'Renamed conversation' })
    expect(await service.listSessionFolders()).toEqual([
      { id: promoted.folderId, name: 'Writing partner', copilotId: 'writer' },
    ])
    expect(copied.folderId).toBe(promoted.folderId)
    expect(getCopilotName).toHaveBeenCalledExactlyOnceWith('writer')
  })

  test('uses the selected remote copilot definition without persisting the name hint', async () => {
    const { service, repository, getCopilotName } = harness()
    const session = await service.createSession(
      { ...copilot, copilotId: 'remote', name: 'A conversation title' },
      undefined,
      { copilotName: 'Remote writing partner' }
    )
    expect(await service.listSessionFolders()).toEqual([
      { id: session.folderId, name: 'Remote writing partner', copilotId: 'remote' },
    ])
    expect(getCopilotName).not.toHaveBeenCalled()
    expect((await repository.getSessionHeader(session.id))?.header).not.toHaveProperty('copilotName')
  })

  test('does not invent a directory name for an unavailable copilot', async () => {
    const { service, getCopilotName } = harness()
    const session = await service.createSession({ ...copilot, copilotId: 'deleted', name: 'An unrelated thread title' })
    expect(session.folderId).toBeUndefined()
    expect(await service.listSessionFolders()).toEqual([])
    getCopilotName.mockResolvedValueOnce('  ')
    expect((await service.createSession(copilot)).folderId).toBeUndefined()
  })

  test('reuses a renamed directory even when the copilot is unavailable', async () => {
    const { service, getCopilotName } = harness([{ id: 'folder', name: 'My collection', copilotId: 'deleted' }])
    expect((await service.createSession({ ...copilot, copilotId: 'deleted' })).folderId).toBe('folder')
    expect(getCopilotName).not.toHaveBeenCalled()
  })

  test('a failed name lookup does not block creation or invent a directory', async () => {
    const { service, getCopilotName } = harness()
    getCopilotName.mockRejectedValueOnce(new Error('Copilot storage unavailable'))
    expect((await service.createSession(copilot)).folderId).toBeUndefined()
    expect(await service.listSessionFolders()).toEqual([])
  })

  test('folder schema retains copilot identity and accepts existing folders', () => {
    expect(SessionFolderSchema.parse({ id: 'a', name: 'Writer', copilotId: 'writer' }).copilotId).toBe('writer')
    expect(SessionFolderSchema.parse({ id: 'a', name: 'Manual' })).toEqual({ id: 'a', name: 'Manual' })
  })
})
