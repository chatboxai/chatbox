// @vitest-environment jsdom

import type { SessionFolder } from '@shared/types'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const { state } = vi.hoisted(() => ({ state: { folders: [] as SessionFolder[] } }))

vi.mock('@/app/backup-operation-guard', () => ({ guardBackupWrite: vi.fn(async () => true) }))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: {
      updateSessionFolders: vi.fn((update: (folders: SessionFolder[]) => SessionFolder[] | null) => {
        state.folders = update(state.folders) ?? state.folders
        return Promise.resolve(state.folders)
      }),
    },
  },
}))

import { uiStore } from '../uiStore'
import { createSessionFolder } from './folders'

describe('createSessionFolder', () => {
  beforeEach(() => {
    state.folders = []
    uiStore.setState({ collapsedSessionFolderIds: [] })
  })

  test('creates a named project without a directory', async () => {
    const folder = await createSessionFolder('Notes')

    expect(folder).toMatchObject({ name: 'Notes' })
    expect(folder?.workingDirectory).toBeUndefined()
    expect(state.folders).toEqual([folder])
  })

  test('names a directory project after the directory when the name is empty', async () => {
    const folder = await createSessionFolder('', '/Users/me/code/chatbox/')

    expect(folder).toMatchObject({ name: 'chatbox', workingDirectory: '/Users/me/code/chatbox' })
  })

  test('returns and expands the project that already collects the directory', async () => {
    state.folders = [{ id: 'existing', name: 'Chatbox', workingDirectory: '/Users/me/code/chatbox' }]
    uiStore.setState({ collapsedSessionFolderIds: ['existing'] })

    const folder = await createSessionFolder('Other', '/Users/me/code/chatbox/')

    expect(folder?.id).toBe('existing')
    expect(state.folders).toHaveLength(1)
    expect(uiStore.getState().collapsedSessionFolderIds).toEqual([])
  })
})
