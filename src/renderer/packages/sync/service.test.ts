import type { Settings } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import { decryptJsonEnvelope, encryptJsonEnvelope } from './crypto'
import { downloadAndMergeWebDAVSnapshot, uploadWebDAVSnapshot } from './service'
import type { SyncSnapshot, WebDAVRequest } from './types'

const baseSettings = {
  sync: {
    enabled: true,
    provider: 'webdav',
    webdav: {
      url: 'https://dav.example.com/files/me/',
      username: 'alice',
      password: 'app-password',
      syncPassword: 'sync-secret',
    },
  },
} as Settings

function session(id: string, name: string, text: string) {
  return {
    id,
    type: 'chat' as const,
    name,
    messages: [
      {
        id: `${id}-m1`,
        role: 'user' as const,
        contentParts: [{ type: 'text' as const, text }],
      },
    ],
  }
}

function meta(id: string, name: string, sortOrder = 1) {
  return {
    id,
    name,
    type: 'chat' as const,
    sortOrder,
    createdAt: sortOrder,
  }
}

describe('WebDAV sync service', () => {
  it('uploads an encrypted snapshot to the fixed WebDAV path', async () => {
    const requests: WebDAVRequest[] = []
    const deps = {
      platform: {
        getDeviceName: vi.fn(async () => 'Mac'),
        webdavRequest: vi.fn((request: WebDAVRequest) => {
          requests.push(request)
          return Promise.resolve({
            status: request.method === 'PUT' ? 201 : request.method === 'GET' ? 404 : 405,
            headers: {},
            body: '',
          })
        }),
      },
      listLocalSessions: vi.fn(async () => [session('s1', 'Local', 'hello')]),
      listLocalMetas: vi.fn(async () => [meta('s1', 'Local')]),
      saveSession: vi.fn(),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      createId: vi.fn(),
      now: () => 1000,
    }

    const result = await uploadWebDAVSnapshot(baseSettings, deps)
    const put = requests.find((request) => request.method === 'PUT')

    expect(result.uploaded).toBe(1)
    expect(put?.url).toBe('https://dav.example.com/files/me/ChatboxSync/v1/snapshot.json.enc')
    expect(put?.headers?.Authorization).toBe(`Basic ${btoa('alice:app-password')}`)
    expect(put?.body).not.toContain('hello')

    const envelope = JSON.parse(put?.body ?? '{}')
    const decrypted = await decryptJsonEnvelope<SyncSnapshot>(envelope, 'sync-secret')
    expect(decrypted.sessions.map((item) => item.id)).toEqual(['s1'])
    expect(deps.updateLastSyncedAt).toHaveBeenCalledWith('1970-01-01T00:00:01.000Z')
  })

  it('merges the existing remote snapshot before uploading local sessions', async () => {
    const requests: WebDAVRequest[] = []
    const remote: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-06-21T00:00:00.000Z',
      deviceName: 'Phone',
      sessions: [session('remote-1', 'Remote', 'remote text')],
      metas: [meta('remote-1', 'Remote')],
    }
    const remoteEnvelope = await encryptJsonEnvelope(remote, 'sync-secret')
    const deps = {
      platform: {
        getDeviceName: vi.fn(async () => 'Mac'),
        webdavRequest: vi.fn((request: WebDAVRequest) => {
          requests.push(request)
          if (request.method === 'GET') {
            return Promise.resolve({ status: 200, headers: {}, body: JSON.stringify(remoteEnvelope) })
          }
          return Promise.resolve({ status: request.method === 'PUT' ? 201 : 405, headers: {}, body: '' })
        }),
      },
      listLocalSessions: vi.fn(async () => [session('local-1', 'Local', 'local text')]),
      listLocalMetas: vi.fn(async () => [meta('local-1', 'Local')]),
      saveSession: vi.fn(),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      createId: vi.fn(() => 'copy-id'),
      now: () => 1000,
    }

    const result = await uploadWebDAVSnapshot(baseSettings, deps)
    const put = requests.find((request) => request.method === 'PUT')
    const envelope = JSON.parse(put?.body ?? '{}')
    const decrypted = await decryptJsonEnvelope<SyncSnapshot>(envelope, 'sync-secret')

    expect(result.uploaded).toBe(2)
    expect(decrypted.sessions.map((item) => item.id).sort()).toEqual(['local-1', 'remote-1'])
    expect(decrypted.metas.map((item) => item.id).sort()).toEqual(['local-1', 'remote-1'])
    expect(deps.saveSession).not.toHaveBeenCalled()
    expect(deps.saveMetas).not.toHaveBeenCalled()
  })

  it('downloads, decrypts, and saves missing remote sessions', async () => {
    const remote: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-06-21T00:00:00.000Z',
      deviceName: 'Phone',
      sessions: [session('remote-1', 'Remote', 'hi')],
      metas: [meta('remote-1', 'Remote')],
    }
    const envelope = await encryptJsonEnvelope(remote, 'sync-secret')
    const deps = {
      platform: {
        webdavRequest: vi.fn(async (request: WebDAVRequest) => ({
          status: request.method === 'GET' ? 200 : 405,
          headers: {},
          body: JSON.stringify(envelope),
        })),
      },
      listLocalSessions: vi.fn(async () => []),
      listLocalMetas: vi.fn(async () => []),
      saveSession: vi.fn(),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      createId: vi.fn(() => 'copy-id'),
      now: () => 2000,
    }

    const result = await downloadAndMergeWebDAVSnapshot(baseSettings, deps)

    expect(result.imported).toBe(1)
    expect(result.conflicts).toBe(0)
    expect(deps.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'remote-1',
        messages: remote.sessions[0].messages,
        name: 'Remote',
        type: 'chat',
      })
    )
    expect(deps.saveMetas).toHaveBeenCalledWith(remote.metas)
    expect(deps.updateLastSyncedAt).toHaveBeenCalledWith('1970-01-01T00:00:02.000Z')
  })

  it('rejects plaintext HTTP WebDAV URLs before sending credentials', async () => {
    const deps = {
      platform: {
        webdavRequest: vi.fn(),
      },
      listLocalSessions: vi.fn(async () => [session('s1', 'Local', 'hello')]),
      listLocalMetas: vi.fn(async () => [meta('s1', 'Local')]),
      saveSession: vi.fn(),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      createId: vi.fn(),
    }
    const settings = {
      ...baseSettings,
      sync: {
        ...baseSettings.sync,
        webdav: {
          ...baseSettings.sync.webdav,
          url: 'http://dav.example.com/files/me/',
        },
      },
    } as Settings

    await expect(uploadWebDAVSnapshot(settings, deps)).rejects.toThrow(/https/i)
    expect(deps.platform.webdavRequest).not.toHaveBeenCalled()
  })

  it('rejects malformed decrypted remote snapshots', async () => {
    const envelope = await encryptJsonEnvelope({ version: 1, sessions: 'not-array', metas: [] }, 'sync-secret')
    const deps = {
      platform: {
        webdavRequest: vi.fn(async () => ({
          status: 200,
          headers: {},
          body: JSON.stringify(envelope),
        })),
      },
      listLocalSessions: vi.fn(async () => []),
      listLocalMetas: vi.fn(async () => []),
      saveSession: vi.fn(),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      createId: vi.fn(() => 'copy-id'),
    }

    await expect(downloadAndMergeWebDAVSnapshot(baseSettings, deps)).rejects.toThrow(/invalid sync snapshot/i)
    expect(deps.saveSession).not.toHaveBeenCalled()
    expect(deps.saveMetas).not.toHaveBeenCalled()
    expect(deps.updateLastSyncedAt).not.toHaveBeenCalled()
  })

  it('migrates legacy remote messages before saving downloaded sessions', async () => {
    const remote = {
      version: 1,
      exportedAt: '2026-06-21T00:00:00.000Z',
      deviceName: 'Phone',
      sessions: [
        {
          id: 'legacy-remote',
          type: 'chat',
          name: 'Legacy Remote',
          messages: [
            {
              id: 'message-1',
              role: 'user',
              content: 'legacy remote text',
            },
          ],
        },
      ],
      metas: [meta('legacy-remote', 'Legacy Remote')],
    }
    const envelope = await encryptJsonEnvelope(remote, 'sync-secret')
    const deps = {
      platform: {
        webdavRequest: vi.fn(async (request: WebDAVRequest) => ({
          status: request.method === 'GET' ? 200 : 405,
          headers: {},
          body: JSON.stringify(envelope),
        })),
      },
      listLocalSessions: vi.fn(async () => []),
      listLocalMetas: vi.fn(async () => []),
      saveSession: vi.fn(),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      createId: vi.fn(() => 'copy-id'),
      now: () => 2000,
    }

    await downloadAndMergeWebDAVSnapshot(baseSettings, deps)

    expect(deps.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'legacy-remote',
        messages: [expect.objectContaining({ contentParts: [{ type: 'text', text: 'legacy remote text' }] })],
      })
    )
  })

  it('rolls back saved sessions when metadata import fails', async () => {
    const remote: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-06-21T00:00:00.000Z',
      deviceName: 'Phone',
      sessions: [session('remote-1', 'Remote 1', 'hi'), session('remote-2', 'Remote 2', 'hello')],
      metas: [meta('remote-1', 'Remote 1'), meta('remote-2', 'Remote 2')],
    }
    const envelope = await encryptJsonEnvelope(remote, 'sync-secret')
    const deps = {
      platform: {
        webdavRequest: vi.fn(async (request: WebDAVRequest) => ({
          status: request.method === 'GET' ? 200 : 405,
          headers: {},
          body: JSON.stringify(envelope),
        })),
      },
      listLocalSessions: vi.fn(async () => []),
      listLocalMetas: vi.fn(async () => []),
      saveSession: vi.fn(),
      saveMetas: vi.fn(() => Promise.reject(new Error('meta write failed'))),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      createId: vi.fn(() => 'copy-id'),
      now: () => 2000,
    }

    await expect(downloadAndMergeWebDAVSnapshot(baseSettings, deps)).rejects.toThrow(/meta write failed/)

    expect(deps.saveSession).toHaveBeenCalledTimes(2)
    expect(deps.deleteSession).toHaveBeenCalledWith('remote-1')
    expect(deps.deleteSession).toHaveBeenCalledWith('remote-2')
    expect(deps.updateLastSyncedAt).not.toHaveBeenCalled()
  })
})
