import type { Session, Settings } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import { decryptJsonEnvelope, encryptJsonEnvelope } from './crypto'
import { downloadAndMergeWebDAVSnapshot, uploadWebDAVSnapshot } from './service'
import type { SyncSnapshot, WebDAVRequest, WebDAVResponse } from './types'

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

function session(id: string, name: string, text: string): Session {
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
      createSession: vi.fn(),
      updateSessionMetadata: vi.fn(),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      createConflictId: vi.fn(),
      now: () => 1000,
    }

    const result = await uploadWebDAVSnapshot(baseSettings, deps)
    const put = requests.find((request) => request.method === 'PUT')

    expect(result.uploaded).toBe(1)
    expect(put?.url).toBe('https://dav.example.com/files/me/ChatboxSync/v1/snapshot.json.enc')
    expect(put?.headers?.Authorization).toBe(`Basic ${btoa('alice:app-password')}`)
    expect(put?.headers?.['If-None-Match']).toBe('*')
    expect(put?.headers?.['If-Match']).toBeUndefined()
    expect(put?.body).not.toContain('hello')

    const envelope = JSON.parse(put?.body ?? '{}')
    const decrypted = await decryptJsonEnvelope<SyncSnapshot>(envelope, 'sync-secret')
    expect(decrypted.sessions.map((item) => item.id)).toEqual(['s1'])
    expect(deps.updateLastSyncedAt).toHaveBeenCalledWith('1970-01-01T00:00:01.000Z')
  })

  it('rejects uploads while any response is still generating', async () => {
    const activeSession = session('s1', 'Local', 'hello')
    activeSession.threads = [
      {
        id: 'thread-1',
        name: 'Thread',
        createdAt: 1,
        messages: [{ ...activeSession.messages[0], generating: true }],
      },
    ]
    const webdavRequest = vi.fn()
    const deps = {
      platform: {
        getDeviceName: vi.fn(async () => 'Mac'),
        webdavRequest,
      },
      listLocalSessions: vi.fn(async () => [activeSession]),
      listLocalMetas: vi.fn(async () => [meta('s1', 'Local')]),
      createSession: vi.fn(),
      updateSessionMetadata: vi.fn(),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      createConflictId: vi.fn(),
      now: () => 1000,
    }

    await expect(uploadWebDAVSnapshot(baseSettings, deps)).rejects.toThrow(/still generating/i)

    expect(webdavRequest).not.toHaveBeenCalled()
    expect(deps.updateLastSyncedAt).not.toHaveBeenCalled()
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
            return Promise.resolve({
              status: 200,
              headers: { ETag: '"remote-etag"' },
              body: JSON.stringify(remoteEnvelope),
            })
          }
          return Promise.resolve({ status: request.method === 'PUT' ? 201 : 405, headers: {}, body: '' })
        }),
      },
      listLocalSessions: vi.fn(async () => [session('local-1', 'Local', 'local text')]),
      listLocalMetas: vi.fn(async () => [meta('local-1', 'Local')]),
      createSession: vi.fn(),
      updateSessionMetadata: vi.fn(),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      createConflictId: vi.fn(() => 'copy-id'),
      now: () => 1000,
    }

    const result = await uploadWebDAVSnapshot(baseSettings, deps)
    const put = requests.find((request) => request.method === 'PUT')
    const envelope = JSON.parse(put?.body ?? '{}')
    const decrypted = await decryptJsonEnvelope<SyncSnapshot>(envelope, 'sync-secret')

    expect(result.uploaded).toBe(2)
    expect(put?.headers?.['If-Match']).toBe('"remote-etag"')
    expect(put?.headers?.['If-None-Match']).toBeUndefined()
    expect(decrypted.sessions.map((item) => item.id).sort()).toEqual(['local-1', 'remote-1'])
    expect(decrypted.metas.map((item) => item.id).sort()).toEqual(['local-1', 'remote-1'])
    expect(deps.createSession).not.toHaveBeenCalled()
    expect(deps.saveMetas).not.toHaveBeenCalled()
  })

  it('re-downloads and merges again when a conditional upload detects a changed remote snapshot', async () => {
    const requests: WebDAVRequest[] = []
    const remoteBeforeRace: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-06-21T00:00:00.000Z',
      deviceName: 'Phone',
      sessions: [session('remote-1', 'Remote 1', 'remote text 1')],
      metas: [meta('remote-1', 'Remote 1')],
    }
    const remoteAfterRace: SyncSnapshot = {
      ...remoteBeforeRace,
      sessions: [...remoteBeforeRace.sessions, session('remote-2', 'Remote 2', 'remote text 2')],
      metas: [...remoteBeforeRace.metas, meta('remote-2', 'Remote 2', 2)],
    }
    let getCount = 0
    let putCount = 0
    const deps = {
      platform: {
        getDeviceName: vi.fn(async () => 'Mac'),
        webdavRequest: vi.fn(async (request: WebDAVRequest): Promise<WebDAVResponse> => {
          requests.push(request)
          if (request.method === 'GET') {
            getCount += 1
            const remote = getCount === 1 ? remoteBeforeRace : remoteAfterRace
            const envelope = await encryptJsonEnvelope(remote, 'sync-secret')
            return {
              status: 200,
              headers: { etag: getCount === 1 ? '"old-etag"' : '"new-etag"' },
              body: JSON.stringify(envelope),
            }
          }
          if (request.method === 'PUT') {
            putCount += 1
            return { status: putCount === 1 ? 412 : 201, headers: {}, body: '' }
          }
          return { status: 405, headers: {}, body: '' }
        }),
      },
      listLocalSessions: vi.fn(async () => [session('local-1', 'Local', 'local text')]),
      listLocalMetas: vi.fn(async () => [meta('local-1', 'Local')]),
      createSession: vi.fn(),
      updateSessionMetadata: vi.fn(),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      createConflictId: vi.fn(() => 'copy-id'),
      now: () => 1000,
    }

    const result = await uploadWebDAVSnapshot(baseSettings, deps)
    const puts = requests.filter((request) => request.method === 'PUT')
    const finalEnvelope = JSON.parse(puts[1]?.body ?? '{}')
    const decrypted = await decryptJsonEnvelope<SyncSnapshot>(finalEnvelope, 'sync-secret')

    expect(result.uploaded).toBe(3)
    expect(requests.filter((request) => request.method === 'GET')).toHaveLength(2)
    expect(puts).toHaveLength(2)
    expect(puts[0].headers?.['If-Match']).toBe('"old-etag"')
    expect(puts[1].headers?.['If-Match']).toBe('"new-etag"')
    expect(decrypted.sessions.map((item) => item.id).sort()).toEqual(['local-1', 'remote-1', 'remote-2'])
    expect(deps.updateLastSyncedAt).toHaveBeenCalledTimes(1)
  })

  it('refuses to overwrite an existing remote snapshot when the server does not return an ETag', async () => {
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
      createSession: vi.fn(),
      updateSessionMetadata: vi.fn(),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      createConflictId: vi.fn(() => 'copy-id'),
      now: () => 1000,
    }

    await expect(uploadWebDAVSnapshot(baseSettings, deps)).rejects.toThrow(/etag/i)

    expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(0)
    expect(deps.updateLastSyncedAt).not.toHaveBeenCalled()
  })

  it('refuses a weak ETag before attempting a conditional upload', async () => {
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
            return Promise.resolve({
              status: 200,
              headers: { ETag: 'W/"remote-etag"' },
              body: JSON.stringify(remoteEnvelope),
            })
          }
          return Promise.resolve({ status: request.method === 'PUT' ? 412 : 405, headers: {}, body: '' })
        }),
      },
      listLocalSessions: vi.fn(async () => [session('local-1', 'Local', 'local text')]),
      listLocalMetas: vi.fn(async () => [meta('local-1', 'Local')]),
      createSession: vi.fn(),
      updateSessionMetadata: vi.fn(),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      now: () => 1000,
    }

    await expect(uploadWebDAVSnapshot(baseSettings, deps)).rejects.toThrow(/weak ETag.*If-Match/i)

    expect(requests.filter((request) => request.method === 'GET')).toHaveLength(1)
    expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(0)
    expect(deps.updateLastSyncedAt).not.toHaveBeenCalled()
  })

  it('skips downloading when the remote snapshot is the one last synced with', async () => {
    const remote: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-06-21T00:00:00.000Z',
      deviceName: 'Phone',
      sessions: [session('same-id', 'Remote', 'remote text')],
      metas: [meta('same-id', 'Remote')],
    }
    const envelope = await encryptJsonEnvelope(remote, 'sync-secret')
    const deps = {
      platform: {
        webdavRequest: vi.fn(async (request: WebDAVRequest) => ({
          status: request.method === 'GET' ? 200 : 405,
          headers: { ETag: '"remote-etag"' },
          body: JSON.stringify(envelope),
        })),
      },
      listLocalSessions: vi.fn(async () => [session('same-id', 'Local', 'local text')]),
      listLocalMetas: vi.fn(async () => [meta('same-id', 'Local')]),
      createSession: vi.fn(),
      updateSessionMetadata: vi.fn(),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      getLastSeenSnapshot: vi.fn(() => ({
        endpoint: 'https://dav.example.com/files/me/\nalice',
        etag: '"remote-etag"',
      })),
      setLastSeenSnapshot: vi.fn(),
      createConflictId: vi.fn(() => 'copy-id'),
      now: () => 2000,
    }

    const result = await downloadAndMergeWebDAVSnapshot(baseSettings, deps)

    expect(result.remoteUnchanged).toBe(true)
    expect(result.imported).toBe(0)
    expect(result.conflicts).toBe(0)
    expect(deps.createSession).not.toHaveBeenCalled()
    expect(deps.listLocalSessions).not.toHaveBeenCalled()
    expect(deps.setLastSeenSnapshot).not.toHaveBeenCalled()
  })

  it('downloads a snapshot whose ETag matches another endpoint only', async () => {
    const remote: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-06-21T00:00:00.000Z',
      deviceName: 'Phone',
      sessions: [session('remote-1', 'Remote', 'remote text')],
      metas: [meta('remote-1', 'Remote')],
    }
    const envelope = await encryptJsonEnvelope(remote, 'sync-secret')
    const deps = {
      platform: {
        webdavRequest: vi.fn(async (request: WebDAVRequest) => ({
          status: request.method === 'GET' ? 200 : 405,
          headers: { ETag: '"remote-etag"' },
          body: JSON.stringify(envelope),
        })),
      },
      listLocalSessions: vi.fn(async () => []),
      listLocalMetas: vi.fn(async () => []),
      createSession: vi.fn(),
      updateSessionMetadata: vi.fn(),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      // A matching ETag recorded for a different WebDAV endpoint/account must
      // never suppress the merge against the current endpoint.
      getLastSeenSnapshot: vi.fn(() => ({
        endpoint: 'https://other.example.com/dav/\nbob',
        etag: '"remote-etag"',
      })),
      setLastSeenSnapshot: vi.fn(),
      createConflictId: vi.fn(() => 'copy-id'),
      now: () => 2000,
    }

    const result = await downloadAndMergeWebDAVSnapshot(baseSettings, deps)

    expect(result.remoteUnchanged).toBeUndefined()
    expect(result.imported).toBe(1)
    expect(deps.createSession).toHaveBeenCalledTimes(1)
    expect(deps.setLastSeenSnapshot).toHaveBeenCalledWith({
      endpoint: 'https://dav.example.com/files/me/\nalice',
      etag: '"remote-etag"',
    })
  })

  it('skips re-merging an already seen remote snapshot during upload', async () => {
    const requests: WebDAVRequest[] = []
    const remote: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-06-21T00:00:00.000Z',
      deviceName: 'Phone',
      sessions: [session('same-id', 'Remote', 'remote text')],
      metas: [meta('same-id', 'Remote')],
    }
    const remoteEnvelope = await encryptJsonEnvelope(remote, 'sync-secret')
    const deps = {
      platform: {
        getDeviceName: vi.fn(async () => 'Mac'),
        webdavRequest: vi.fn((request: WebDAVRequest) => {
          requests.push(request)
          if (request.method === 'GET') {
            return Promise.resolve({
              status: 200,
              headers: { ETag: '"remote-etag"' },
              body: JSON.stringify(remoteEnvelope),
            })
          }
          return Promise.resolve({ status: request.method === 'PUT' ? 201 : 405, headers: {}, body: '' })
        }),
      },
      listLocalSessions: vi.fn(async () => [session('same-id', 'Local', 'local text')]),
      listLocalMetas: vi.fn(async () => [meta('same-id', 'Local')]),
      createSession: vi.fn(),
      updateSessionMetadata: vi.fn(),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      getLastSeenSnapshot: vi.fn(() => ({
        endpoint: 'https://dav.example.com/files/me/\nalice',
        etag: '"remote-etag"',
      })),
      setLastSeenSnapshot: vi.fn(),
      createConflictId: vi.fn(() => 'copy-id'),
      now: () => 1000,
    }

    const result = await uploadWebDAVSnapshot(baseSettings, deps)
    const put = requests.find((request) => request.method === 'PUT')
    const envelope = JSON.parse(put?.body ?? '{}')
    const decrypted = await decryptJsonEnvelope<SyncSnapshot>(envelope, 'sync-secret')

    // The already-seen remote snapshot must not be merged back in, otherwise
    // its divergent content would be re-uploaded as a "(Synced copy)" duplicate.
    expect(result.uploaded).toBe(1)
    expect(decrypted.sessions.map((item) => item.id)).toEqual(['same-id'])
    expect(decrypted.sessions[0].name).toBe('Local')
    // The PUT response carried no ETag, so only the endpoint is remembered and
    // the next download will merge idempotently instead of being skipped.
    expect(deps.setLastSeenSnapshot).toHaveBeenCalledWith({
      endpoint: 'https://dav.example.com/files/me/\nalice',
      etag: undefined,
    })
  })

  it('merges a remote snapshot that has not been seen before during upload', async () => {
    const requests: WebDAVRequest[] = []
    const remote: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-06-22T00:00:00.000Z',
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
            return Promise.resolve({
              status: 200,
              headers: { ETag: '"remote-etag"' },
              body: JSON.stringify(remoteEnvelope),
            })
          }
          return Promise.resolve({ status: request.method === 'PUT' ? 201 : 405, headers: {}, body: '' })
        }),
      },
      listLocalSessions: vi.fn(async () => [session('local-1', 'Local', 'local text')]),
      listLocalMetas: vi.fn(async () => [meta('local-1', 'Local')]),
      createSession: vi.fn(),
      updateSessionMetadata: vi.fn(),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      getLastSeenSnapshot: vi.fn(() => ({
        endpoint: 'https://dav.example.com/files/me/\nalice',
        etag: '"previously-seen-etag"',
      })),
      setLastSeenSnapshot: vi.fn(),
      createConflictId: vi.fn(() => 'copy-id'),
      now: () => 1000,
    }

    const result = await uploadWebDAVSnapshot(baseSettings, deps)
    const put = requests.find((request) => request.method === 'PUT')
    const envelope = JSON.parse(put?.body ?? '{}')
    const decrypted = await decryptJsonEnvelope<SyncSnapshot>(envelope, 'sync-secret')

    expect(result.uploaded).toBe(2)
    expect(decrypted.sessions.map((item) => item.id).sort()).toEqual(['local-1', 'remote-1'])
    // The upload merged remote sessions that were never persisted locally, so
    // the new ETag must not be remembered — otherwise the next download would
    // skip the very merge that saves them.
    expect(deps.setLastSeenSnapshot).not.toHaveBeenCalled()
  })

  it('persists remote-only sessions on the download after a merged upload', async () => {
    // Regression: a merged upload must not mark the uploaded snapshot as seen.
    // The merged snapshot holds remote-only sessions that were never saved
    // locally; remembering its ETag would make every later download report
    // remoteUnchanged and those sessions would never land on this device.
    const remote: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-06-22T00:00:00.000Z',
      deviceName: 'Phone',
      sessions: [session('remote-1', 'Remote', 'remote text')],
      metas: [meta('remote-1', 'Remote')],
    }
    let serverBody = JSON.stringify(await encryptJsonEnvelope(remote, 'sync-secret'))
    let serverEtag = '"etag-v1"'
    let lastSeen: { endpoint: string; etag?: string } | undefined
    // Mirror the migrated shape production storage returns, so the round-trip
    // through the upload/download migration does not look like a conflict.
    const localSession = session('local-1', 'Local', 'local text')
    localSession.settings = { temperature: undefined }
    const deps = {
      platform: {
        getDeviceName: vi.fn(async () => 'Mac'),
        webdavRequest: vi.fn((request: WebDAVRequest) => {
          if (request.method === 'GET') {
            return Promise.resolve({ status: 200, headers: { ETag: serverEtag }, body: serverBody })
          }
          if (request.method === 'PUT') {
            serverBody = request.body ?? ''
            serverEtag = '"etag-v2"'
            return Promise.resolve({ status: 201, headers: { ETag: serverEtag }, body: '' })
          }
          return Promise.resolve({ status: 405, headers: {}, body: '' })
        }),
      },
      listLocalSessions: vi.fn(async () => [localSession]),
      listLocalMetas: vi.fn(async () => [meta('local-1', 'Local')]),
      createSession: vi.fn(),
      updateSessionMetadata: vi.fn(async () => ({ name: 'Local', type: 'chat' as const })),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      getLastSeenSnapshot: vi.fn(() => lastSeen),
      setLastSeenSnapshot: vi.fn((seen: { endpoint: string; etag?: string }) => {
        lastSeen = seen
      }),
      createConflictId: vi.fn(() => 'copy-id'),
      now: () => 1000,
    }

    const upload = await uploadWebDAVSnapshot(baseSettings, deps)

    expect(upload.uploaded).toBe(2)
    expect(lastSeen).toBeUndefined()

    const download = await downloadAndMergeWebDAVSnapshot(baseSettings, deps)

    expect(download.remoteUnchanged).toBeUndefined()
    expect(download.imported).toBe(1)
    expect(deps.createSession).toHaveBeenCalledTimes(1)
    expect(deps.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'remote-1' }),
      expect.objectContaining({ id: 'remote-1' })
    )
    // Once the download has actually persisted the merge, recording the ETag
    // is safe again.
    expect(lastSeen).toEqual({
      endpoint: 'https://dav.example.com/files/me/\nalice',
      etag: '"etag-v2"',
    })
  })

  it('merges a remote snapshot with older timestamps but an unseen ETag during upload', async () => {
    // Regression test for the wall-clock stale gate: a snapshot uploaded by a
    // device with a slow clock (exportedAt behind our last sync) is still a
    // genuinely new snapshot. Skipping its merge here would drop the
    // remote-only session from the PUT body and delete it from the server.
    const requests: WebDAVRequest[] = []
    const remote: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-06-21T09:59:00.000Z',
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
            return Promise.resolve({
              status: 200,
              headers: { ETag: '"remote-etag"' },
              body: JSON.stringify(remoteEnvelope),
            })
          }
          return Promise.resolve({ status: request.method === 'PUT' ? 201 : 405, headers: {}, body: '' })
        }),
      },
      listLocalSessions: vi.fn(async () => [session('local-1', 'Local', 'local text')]),
      listLocalMetas: vi.fn(async () => [meta('local-1', 'Local')]),
      createSession: vi.fn(),
      updateSessionMetadata: vi.fn(),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      getLastSeenSnapshot: vi.fn(() => ({
        endpoint: 'https://dav.example.com/files/me/\nalice',
        etag: '"previously-seen-etag"',
      })),
      setLastSeenSnapshot: vi.fn(),
      createConflictId: vi.fn(() => 'copy-id'),
      now: () => Date.parse('2026-06-21T10:00:00.000Z'),
    }

    const result = await uploadWebDAVSnapshot(baseSettings, deps)
    const put = requests.find((request) => request.method === 'PUT')
    const envelope = JSON.parse(put?.body ?? '{}')
    const decrypted = await decryptJsonEnvelope<SyncSnapshot>(envelope, 'sync-secret')

    expect(result.uploaded).toBe(2)
    expect(decrypted.sessions.map((item) => item.id).sort()).toEqual(['local-1', 'remote-1'])
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
      createSession: vi.fn(),
      updateSessionMetadata: vi.fn(),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      createConflictId: vi.fn(() => 'copy-id'),
      now: () => 2000,
    }

    const result = await downloadAndMergeWebDAVSnapshot(baseSettings, deps)

    expect(result.imported).toBe(1)
    expect(result.conflicts).toBe(0)
    expect(deps.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'remote-1',
        messages: remote.sessions[0].messages,
        name: 'Remote',
        type: 'chat',
      }),
      remote.metas[0]
    )
    expect(deps.saveMetas).not.toHaveBeenCalled()
    expect(deps.updateLastSyncedAt).toHaveBeenCalledWith('1970-01-01T00:00:02.000Z')
  })

  it('downloads metadata-only changes without creating synced copies', async () => {
    const local = session('same-id', 'Local Name', 'same text')
    local.settings = { temperature: undefined }
    const remoteSession = {
      ...session('same-id', 'Remote Name', 'same text'),
      starred: true,
    }
    const remoteMeta = {
      ...meta('same-id', 'Remote Name', 99),
      starred: true,
    }
    const remote: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-06-21T00:00:00.000Z',
      deviceName: 'Phone',
      sessions: [remoteSession],
      metas: [remoteMeta],
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
      listLocalSessions: vi.fn(async () => [local]),
      listLocalMetas: vi.fn(async () => [meta('same-id', 'Local Name', 1)]),
      createSession: vi.fn(),
      updateSessionMetadata: vi.fn(async () => ({ name: 'Local Name', type: 'chat' as const })),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      createConflictId: vi.fn(() => 'copy-id'),
      now: () => 2000,
    }

    const result = await downloadAndMergeWebDAVSnapshot(baseSettings, deps)

    expect(result.imported).toBe(0)
    expect(result.conflicts).toBe(0)
    expect(deps.createConflictId).not.toHaveBeenCalled()
    expect(deps.updateSessionMetadata).toHaveBeenCalledWith(
      'same-id',
      expect.objectContaining({ name: 'Remote Name', starred: true })
    )
    expect(deps.saveMetas).toHaveBeenCalledWith([expect.objectContaining(remoteMeta)])
  })

  it('rejects plaintext HTTP WebDAV URLs before sending credentials', async () => {
    const deps = {
      platform: {
        webdavRequest: vi.fn(),
      },
      listLocalSessions: vi.fn(async () => [session('s1', 'Local', 'hello')]),
      listLocalMetas: vi.fn(async () => [meta('s1', 'Local')]),
      createSession: vi.fn(),
      updateSessionMetadata: vi.fn(),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      createConflictId: vi.fn(),
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
      createSession: vi.fn(),
      updateSessionMetadata: vi.fn(),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      createConflictId: vi.fn(() => 'copy-id'),
    }

    await expect(downloadAndMergeWebDAVSnapshot(baseSettings, deps)).rejects.toThrow(/invalid sync snapshot/i)
    expect(deps.createSession).not.toHaveBeenCalled()
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
      createSession: vi.fn(),
      updateSessionMetadata: vi.fn(),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      createConflictId: vi.fn(() => 'copy-id'),
      now: () => 2000,
    }

    await downloadAndMergeWebDAVSnapshot(baseSettings, deps)

    expect(deps.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'legacy-remote',
        messages: [expect.objectContaining({ contentParts: [{ type: 'text', text: 'legacy remote text' }] })],
      }),
      remote.metas[0]
    )
  })

  it('restores updated sessions and deletes only new sessions when metadata import fails', async () => {
    const local = session('same-id', 'Local Name', 'same text')
    local.settings = { temperature: undefined }
    const remoteExisting = session('same-id', 'Remote Name', 'same text')
    const remote: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-06-21T00:00:00.000Z',
      deviceName: 'Phone',
      sessions: [remoteExisting, session('remote-2', 'Remote 2', 'hello')],
      metas: [meta('same-id', 'Remote Name', 99), meta('remote-2', 'Remote 2')],
    }
    const envelope = await encryptJsonEnvelope(remote, 'sync-secret')
    const previousPatch = {
      name: 'Local Name',
      type: 'chat' as const,
      starred: undefined,
      hidden: undefined,
      assistantAvatarKey: undefined,
      picUrl: undefined,
      backgroundImage: undefined,
    }
    const deps = {
      platform: {
        webdavRequest: vi.fn(async (request: WebDAVRequest) => ({
          status: request.method === 'GET' ? 200 : 405,
          headers: {},
          body: JSON.stringify(envelope),
        })),
      },
      listLocalSessions: vi.fn(async () => [local]),
      listLocalMetas: vi.fn(async () => [meta('same-id', 'Local Name')]),
      createSession: vi.fn(),
      updateSessionMetadata: vi.fn(async () => previousPatch),
      saveMetas: vi.fn(() => Promise.reject(new Error('meta write failed'))),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      createConflictId: vi.fn(() => 'copy-id'),
      now: () => 2000,
    }

    await expect(downloadAndMergeWebDAVSnapshot(baseSettings, deps)).rejects.toThrow(/meta write failed/)

    expect(deps.createSession).toHaveBeenCalledTimes(1)
    expect(deps.deleteSession).toHaveBeenCalledWith('remote-2')
    expect(deps.deleteSession).not.toHaveBeenCalledWith('same-id')
    expect(deps.updateSessionMetadata).toHaveBeenNthCalledWith(
      1,
      'same-id',
      expect.objectContaining({ name: 'Remote Name' })
    )
    expect(deps.updateSessionMetadata).toHaveBeenNthCalledWith(2, 'same-id', previousPatch)
    expect(deps.updateLastSyncedAt).not.toHaveBeenCalled()
  })

  it('removes earlier new sessions when a later create fails', async () => {
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
      createSession: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('second session write failed')),
      updateSessionMetadata: vi.fn(),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(),
      updateLastSyncedAt: vi.fn(),
      now: () => 2000,
    }

    await expect(downloadAndMergeWebDAVSnapshot(baseSettings, deps)).rejects.toThrow(/second session write failed/)

    expect(deps.deleteSession).toHaveBeenCalledTimes(1)
    expect(deps.deleteSession).toHaveBeenCalledWith('remote-1')
    expect(deps.saveMetas).not.toHaveBeenCalled()
    expect(deps.updateLastSyncedAt).not.toHaveBeenCalled()
  })

  it('wraps the original and rollback errors in an AggregateError when restoring also fails', async () => {
    const remote: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-06-21T00:00:00.000Z',
      deviceName: 'Phone',
      sessions: [session('remote-1', 'Remote 1', 'hi'), session('remote-2', 'Remote 2', 'hello')],
      metas: [meta('remote-1', 'Remote 1'), meta('remote-2', 'Remote 2')],
    }
    const envelope = await encryptJsonEnvelope(remote, 'sync-secret')
    const importError = new Error('second session write failed')
    const rollbackError = new Error('delete failed')
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
      createSession: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(importError),
      updateSessionMetadata: vi.fn(),
      saveMetas: vi.fn(),
      deleteSession: vi.fn(() => Promise.reject(rollbackError)),
      updateLastSyncedAt: vi.fn(),
      now: () => 2000,
    }

    const failure = await downloadAndMergeWebDAVSnapshot(baseSettings, deps).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as Error).message).toMatch(/restoring local data also failed/)
    expect((failure as AggregateError).errors).toEqual([importError, rollbackError])
    expect(deps.deleteSession).toHaveBeenCalledWith('remote-1')
    expect(deps.updateLastSyncedAt).not.toHaveBeenCalled()
  })
})
