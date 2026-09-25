import { describe, expect, test } from 'vitest'
import type { SessionFolderStorePort } from '../../ports'
import { InMemorySessionRepository } from '../../testing/InMemorySessionRepository'
import type { Session, SessionFolder } from '../../types'
import { SessionService } from './SessionService'
import { SessionWriteCoordinator } from './SessionWriteCoordinator'
import { SessionEventBus } from './session-events'
import { directoryFolderName, getSessionWorkingDirectory } from './working-directory-folders'

function workSettings(...workingDirectories: string[]): Session['settings'] {
  return {
    agentMode: { value: 'on', locked: false, lockReason: null },
    workingDirectories,
  }
}

function createHarness(options: { withFolderStore?: boolean } = {}) {
  const repository = new InMemorySessionRepository()
  const stored: SessionFolder[][] = []
  const folderStore: SessionFolderStorePort = {
    load: () => Promise.resolve([]),
    save: (folders) => {
      stored.push(folders)
      return Promise.resolve()
    },
  }
  let nextId = 0
  const service = new SessionService(repository, new SessionWriteCoordinator(repository), new SessionEventBus(), {
    createId: () => `id-${++nextId}`,
    now: () => 100,
    folders: options.withFolderStore === false ? undefined : folderStore,
  })
  return { repository, service, stored }
}

describe('getSessionWorkingDirectory', () => {
  test('uses the first working directory of a Work Mode session', () => {
    expect(getSessionWorkingDirectory({ settings: workSettings(' ', '/Users/me/app/', '/tmp') })).toBe('/Users/me/app')
    expect(getSessionWorkingDirectory({ settings: workSettings('C:\\code\\app\\') })).toBe('C:\\code\\app')
    expect(getSessionWorkingDirectory({ settings: workSettings('/') })).toBe('/')
  })

  test('ignores chat sessions and Work Mode sessions without a directory', () => {
    expect(
      getSessionWorkingDirectory({
        settings: { ...workSettings('/app'), agentMode: { value: 'off', locked: false, lockReason: null } },
      })
    ).toBeUndefined()
    expect(getSessionWorkingDirectory({ settings: workSettings() })).toBeUndefined()
  })
})

describe('directoryFolderName', () => {
  test('uses the basename and adds the parent when the name is taken', () => {
    expect(directoryFolderName('/Users/me/app', [])).toBe('app')
    expect(directoryFolderName('/Users/other/app', [{ id: 'a', name: 'app', workingDirectory: '/Users/me/app' }])).toBe(
      'other/app'
    )
    expect(directoryFolderName('C:\\code\\app', [])).toBe('app')
  })
})

describe('SessionService working directory folders', () => {
  test('files new Work Mode sessions into one folder per directory', async () => {
    const { service } = createHarness()

    const first = await service.createSession({ name: 'A', messages: [], settings: workSettings('/Users/me/app/') })
    const second = await service.createSession({ name: 'B', messages: [], settings: workSettings('/Users/me/app') })
    const chat = await service.createSession({ name: 'C', messages: [] })

    const folders = await service.listSessionFolders()
    expect(folders).toEqual([{ id: expect.any(String), name: 'app', workingDirectory: '/Users/me/app' }])
    expect(first.folderId).toBe(folders[0].id)
    expect(second.folderId).toBe(folders[0].id)
    expect(chat.folderId).toBeUndefined()
    const page = await service.listSessionsMetaPage(0, 10)
    expect(page.items.find((item) => item.id === first.id)?.folderId).toBe(folders[0].id)
  })

  test('leaves sessions unfiled on hosts without a folder store', async () => {
    const { service } = createHarness({ withFolderStore: false })
    const session = await service.createSession({ name: 'A', messages: [], settings: workSettings('/app') })
    expect(session.folderId).toBeUndefined()
    expect(await service.listSessionFolders()).toEqual([])
  })

  test('follows a directory change from the previous directory folder', async () => {
    const { service } = createHarness()
    const session = await service.createSession({ name: 'A', messages: [], settings: workSettings('/work/api') })

    const moved = await service.updateSession(session.id, { settings: workSettings('/work/web') })

    const folders = await service.listSessionFolders()
    expect(folders.map((folder) => folder.workingDirectory)).toEqual(['/work/api', '/work/web'])
    expect(moved.folderId).toBe(folders[1].id)
  })

  test('keeps a folder the user picked when the directory changes', async () => {
    const { service } = createHarness()
    const session = await service.createSession({ name: 'A', messages: [], settings: workSettings('/work/api') })
    await service.updateSessionFolders((folders) => [...folders, { id: 'manual', name: 'Manual' }])
    await service.moveSessionToFolder(session.id, 'manual')

    const updated = await service.updateSession(session.id, { settings: workSettings('/work/web') })

    expect(updated.folderId).toBe('manual')
  })

  test('keeps a session the user unfiled while its directory stays the same', async () => {
    const { service } = createHarness()
    const session = await service.createSession({ name: 'A', messages: [], settings: workSettings('/work/api') })
    await service.moveSessionToFolder(session.id, undefined)

    const renamed = await service.updateSession(session.id, { name: 'Renamed' })

    expect(renamed.folderId).toBeUndefined()
  })

  test('files a chat session once it switches to Work Mode with a directory', async () => {
    const { service } = createHarness()
    const session = await service.createSession({ name: 'A', messages: [] })

    const updated = await service.updateSession(session.id, { settings: workSettings('/work/api') })

    expect(updated.folderId).toBe((await service.listSessionFolders())[0].id)
  })

  test('recreates a deleted directory folder for the next session', async () => {
    const { service } = createHarness()
    await service.createSession({ name: 'A', messages: [], settings: workSettings('/work/api') })
    await service.saveSessionFolders([])

    const next = await service.createSession({ name: 'B', messages: [], settings: workSettings('/work/api') })

    const folders = await service.listSessionFolders()
    expect(folders).toHaveLength(1)
    expect(next.folderId).toBe(folders[0].id)
  })

  test('applies concurrent folder updates in turn', async () => {
    const { service, stored } = createHarness()

    await Promise.all([
      service.updateSessionFolders((folders) => [...folders, { id: 'a', name: 'A' }]),
      service.updateSessionFolders((folders) => [...folders, { id: 'b', name: 'B' }]),
      service.createSession({ name: 'C', messages: [], settings: workSettings('/work/api') }),
    ])

    const folders = await service.listSessionFolders()
    expect(folders.map((folder) => folder.workingDirectory ?? folder.id).sort()).toEqual(['/work/api', 'a', 'b'])
    expect(stored.at(-1)).toHaveLength(3)
  })
})
