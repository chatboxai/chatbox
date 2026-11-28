import type { WebContents } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SyncIpcChannels } from '../../shared/sync'
import { registerSyncHandlers } from './ipc'
import type { StoredSyncState } from './types'

type Handler = (_event: unknown, input?: unknown) => Promise<unknown>
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  stored: {} as StoredSyncState,
}))

vi.mock('electron', () => ({
  app: { isPackaged: false },
  ipcMain: { handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler) },
  shell: {},
}))
vi.mock('./baidu-oauth', () => ({}))
vi.mock('./webdav-cloud', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./webdav-cloud')>()),
  testWebDavConnection: vi.fn(async () => {}),
}))

function appRenderer() {
  const frame = { url: 'http://localhost:1212/#/settings' }
  const sender = { mainFrame: frame, isDestroyed: () => false } as unknown as WebContents
  return { sender, senderFrame: frame }
}

beforeEach(() => {
  vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:1212/')
  mocks.handlers.clear()
})

afterEach(() => vi.unstubAllEnvs())
vi.mock('./credential-store', () => ({
  SyncCredentialStore: class {
    load() {
      return Promise.resolve(mocks.stored)
    }
    update(mutate: (stored: StoredSyncState) => StoredSyncState) {
      return Promise.resolve().then(() => {
        mocks.stored = mutate(mocks.stored)
        return mocks.stored
      })
    }
  },
}))

function registeredHandler(channel: string): Handler {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  return handler
}

it('keeps legacy Baidu history, isolates WebDAV history, and rejects superseded targets', async () => {
  const baiduBaseline = { cloudRevision: 'baidu-revision' }
  mocks.stored = {
    preferences: {
      enabled: true,
      mode: 'interval',
      intervalMinutes: 30,
      encryptionEnabled: true,
      selection: { sessions: true, settings: true, copilots: true, credentials: false },
      lastSyncAt: 1,
      baseline: baiduBaseline,
    },
  }
  const event = appRenderer()
  registerSyncHandlers(() => event.sender)
  const invoke = (channel: string, input?: unknown) => registeredHandler(channel)(event, input)
  expect(await invoke(SyncIpcChannels.PREFERENCES_GET)).toMatchObject({
    service: 'baidu-netdisk',
    lastSyncAt: 1,
    baseline: baiduBaseline,
  })

  const config = { url: 'https://first.example.test/dav/', username: 'user', password: 'secret' }
  expect(await invoke(SyncIpcChannels.WEBDAV_CONFIGURE, config)).toMatchObject({
    success: true,
    preferences: { webdav: { url: config.url, username: 'user', passwordConfigured: true } },
  })
  expect(await invoke(SyncIpcChannels.PREFERENCES_SET, { service: 'webdav' })).toMatchObject({
    service: 'webdav',
    lastSyncAt: undefined,
    baseline: undefined,
    encryptionEnabled: true,
  })
  const target = { service: 'webdav', id: mocks.stored.webdav?.id }
  const completed = { target, lastSyncAt: 2, baseline: { cloudRevision: 'webdav-revision' } }
  const webdavPreferences = await invoke(SyncIpcChannels.SYNC_RESULT, completed)
  expect(webdavPreferences).toMatchObject({ service: 'webdav', lastSyncAt: 2, baseline: completed.baseline })
  expect(JSON.stringify(webdavPreferences)).not.toContain('"secret"')
  expect(await invoke(SyncIpcChannels.PREFERENCES_SET, { service: 'baidu-netdisk' })).toMatchObject({
    lastSyncAt: 1,
    baseline: baiduBaseline,
  })
  await expect(invoke(SyncIpcChannels.SYNC_RESULT, completed)).rejects.toThrow('sync_target_changed')
  expect(await invoke(SyncIpcChannels.PREFERENCES_SET, { service: 'webdav' })).toMatchObject({ lastSyncAt: 2 })
  await invoke(SyncIpcChannels.WEBDAV_CONFIGURE, { ...config, url: 'https://second.example.test/dav/' })
  expect(await invoke(SyncIpcChannels.PREFERENCES_GET)).toMatchObject({ lastSyncAt: undefined, baseline: undefined })
  await expect(invoke(SyncIpcChannels.SYNC_RESULT, completed)).rejects.toThrow('sync_target_changed')
})

it('reveals only the requested matching credential to the app renderer', async () => {
  mocks.stored = {
    configuration: { clientId: 'app', clientSecret: 'baidu-secret', scope: 'basic,netdisk' },
    credentials: { accessToken: 'oauth-access', refreshToken: 'oauth-refresh', expiresAt: 1, lastCallAt: 1 },
    webdav: { id: 'target', username: 'user', url: 'https://example.test/dav/', password: 'dav-secret' },
    encryptionToken: 'encryption-token',
  }
  const event = appRenderer()
  const frame = event.senderFrame
  registerSyncHandlers(() => event.sender)
  const invoke = registeredHandler(SyncIpcChannels.READ_SAVED_SECRET)
  try {
    await expect(invoke(event, { kind: 'baidu-secret-key', clientId: 'app' })).resolves.toBe('baidu-secret')
    await expect(invoke(event, { kind: 'webdav-password', id: 'target' })).resolves.toBe('dav-secret')
    await expect(invoke(event, { kind: 'encryption-token' })).resolves.toBe('encryption-token')
    await expect(invoke(event, { kind: 'webdav-password', id: 'another' })).rejects.toThrow(
      'sync_saved_secret_unavailable'
    )
    await expect(invoke(event, { kind: 'refresh-token' })).rejects.toThrow('sync_saved_secret_unavailable')
    await expect(invoke({ ...event, senderFrame: { ...frame } }, { kind: 'encryption-token' })).rejects.toThrow(
      'sync_saved_secret_unavailable'
    )
    frame.url = 'https://example.test/'
    await expect(invoke(event, { kind: 'encryption-token' })).rejects.toThrow('sync_saved_secret_unavailable')
    await expect(registeredHandler(SyncIpcChannels.PREFERENCES_GET)(event)).rejects.toThrow('sync_unavailable')
  } finally {
    vi.unstubAllEnvs()
  }
})
