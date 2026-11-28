import { randomUUID } from 'node:crypto'
import { type IpcMainInvokeEvent, ipcMain, shell, type WebContents } from 'electron'
import type {
  BaiduAccountResult,
  BaiduAccountStatus,
  BaiduLoginRequest,
  CloudDownloadResult,
  CloudUploadRequest,
  CloudUploadResult,
  SavedSyncSecret,
  SyncCompletion,
  SyncPreferences,
  SyncPreferencesUpdate,
  SyncTarget,
  WebDavConfigurationInput,
  WebDavConfigurationResult,
} from '../../shared/sync'
import { defaultSyncPreferences, isSyncSelection, SyncIpcChannels } from '../../shared/sync'
import { downloadCloud, uploadCloud } from './baidu-cloud'
import { loginToBaidu, refreshBaiduCredentials } from './baidu-oauth'
import { SyncCredentialStore } from './credential-store'
import { isSyncSender } from './sender'
import type { BaiduAppConfiguration, StoredBaiduCredentials, StoredSyncState } from './types'
import { downloadWebDav, normalizeWebDavConfiguration, testWebDavConnection, uploadWebDav } from './webdav-cloud'

const refreshBeforeExpiryMs = 5 * 60 * 1000
const { encryptionTokenConfigured: _tokenConfigured, ...defaultPreferences } = defaultSyncPreferences

function accountStatus(credentials?: StoredBaiduCredentials): BaiduAccountStatus {
  if (!credentials) return { authenticated: false }
  return {
    authenticated: true,
    userId: credentials.profile?.userId,
    displayName: credentials.profile?.displayName,
    avatarUrl: credentials.profile?.avatarUrl,
    expiresAt: credentials.expiresAt,
    lastCallAt: credentials.lastCallAt,
  }
}

function configurationStatus(configuration?: BaiduAppConfiguration) {
  return {
    clientId: configuration?.clientId,
    clientSecretConfigured: Boolean(configuration?.clientSecret),
  }
}

function resolveConfiguration(request: BaiduLoginRequest, stored: StoredSyncState): BaiduAppConfiguration {
  const clientId = request.clientId.trim()
  const storedSecret = stored.configuration?.clientId === clientId ? stored.configuration.clientSecret : undefined
  const clientSecret = request.clientSecret?.trim() || storedSecret || ''
  return { clientId, clientSecret, scope: 'basic,netdisk' }
}

function readPreferences(stored: StoredSyncState): SyncPreferences {
  const service = stored.preferences?.service ?? defaultPreferences.service
  const webdav = stored.webdav
  const history = service === 'webdav' ? webdav : stored.preferences
  return {
    ...defaultPreferences,
    ...stored.preferences,
    service,
    baseline: history?.baseline,
    lastSyncAt: history?.lastSyncAt,
    encryptionTokenConfigured: Boolean(stored.encryptionToken),
    webdav: webdav && {
      id: webdav.id,
      url: webdav.url,
      username: webdav.username,
      passwordConfigured: Boolean(webdav.password),
    },
  }
}

function assertTarget(stored: StoredSyncState, target: SyncTarget): void {
  if (
    !target ||
    (stored.preferences?.service ?? defaultPreferences.service) !== target.service ||
    (target.service === 'webdav' && (!stored.webdav || stored.webdav.id !== target.id))
  ) {
    throw new Error('sync_target_changed')
  }
}

function publicError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback
  const { message } = error
  if (/^(?:(?:baidu|cloud|webdav|sync|encryption|unsupported)_\w+|webdav_http_error:\d{3})$/.test(message)) {
    return message
  }
  return fallback
}

export function registerSyncHandlers(getMainContents: () => WebContents | undefined): void {
  const store = new SyncCredentialStore()
  let activeLogin: AbortController | undefined
  let refresh: { token: string; result: Promise<StoredBaiduCredentials> } | undefined

  function handle<Args extends unknown[], Result>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: Args) => Result
  ) {
    ipcMain.handle(channel, async (event, ...args: Args) => {
      if (!isSyncSender(event, getMainContents())) {
        throw new Error(
          channel === SyncIpcChannels.READ_SAVED_SECRET ? 'sync_saved_secret_unavailable' : 'sync_unavailable'
        )
      }
      try {
        return await handler(event, ...args)
      } catch (error) {
        throw new Error(publicError(error, 'sync_failed'))
      }
    })
  }

  handle(SyncIpcChannels.READ_SAVED_SECRET, async (event, request: SavedSyncSecret): Promise<string> => {
    const stored = await store.load()
    if (!isSyncSender(event, getMainContents())) {
      throw new Error('sync_saved_secret_unavailable')
    }
    if (request?.kind === 'baidu-secret-key' && stored.configuration?.clientId === request.clientId) {
      return stored.configuration?.clientSecret ?? ''
    }
    if (request?.kind === 'webdav-password' && stored.webdav?.id === request.id) {
      return stored.webdav?.password ?? ''
    }
    if (request?.kind === 'encryption-token') return stored.encryptionToken ?? ''
    throw new Error('sync_saved_secret_unavailable')
  })

  handle(SyncIpcChannels.BAIDU_LOGIN, async (_event, request: BaiduLoginRequest): Promise<BaiduAccountResult> => {
    activeLogin?.abort()
    const controller = new AbortController()
    activeLogin = controller
    let savedConfiguration: ReturnType<typeof configurationStatus> | undefined

    try {
      const stored = await store.load()
      const configuration = resolveConfiguration(request, stored)
      savedConfiguration = configurationStatus(stored.configuration)
      const credentials = await loginToBaidu(configuration, (url) => shell.openExternal(url), controller.signal)
      await store.update((current) => {
        controller.signal.throwIfAborted()
        const sameAccount =
          configuration.clientId === current.configuration?.clientId &&
          Boolean(credentials.profile?.userId) &&
          credentials.profile?.userId === current.credentials?.profile?.userId
        const preferences =
          sameAccount || !current.preferences
            ? current.preferences
            : { ...current.preferences, baseline: undefined, lastSyncAt: undefined }
        return { ...current, configuration, credentials, preferences }
      })
      return {
        success: true,
        account: accountStatus(credentials),
        configuration: configurationStatus(configuration),
      }
    } catch (error) {
      return {
        success: false,
        error: controller.signal.aborted ? 'login_cancelled' : publicError(error, 'baidu_login_failed'),
        configuration: savedConfiguration,
      }
    } finally {
      if (activeLogin === controller) activeLogin = undefined
    }
  })

  handle(SyncIpcChannels.BAIDU_CANCEL_LOGIN, (): BaiduAccountResult => {
    activeLogin?.abort()
    activeLogin = undefined
    return { success: true }
  })

  handle(SyncIpcChannels.BAIDU_STATUS, async (): Promise<BaiduAccountResult> => {
    let configuration: ReturnType<typeof configurationStatus> | undefined
    try {
      const stored = await store.load()
      configuration = configurationStatus(stored.configuration)
      const credentials = stored.credentials ? await usableBaiduCredentials(stored) : undefined
      return {
        success: true,
        account: accountStatus(credentials),
        configuration,
      }
    } catch (error) {
      return { success: false, error: publicError(error, 'baidu_status_failed'), configuration }
    }
  })

  handle(SyncIpcChannels.BAIDU_LOGOUT, async (): Promise<BaiduAccountResult> => {
    activeLogin?.abort()
    activeLogin = undefined
    const stored = await store.update((current) => ({
      ...current,
      credentials: undefined,
      preferences: current.preferences && { ...current.preferences, baseline: undefined, lastSyncAt: undefined },
    }))
    return {
      success: true,
      account: { authenticated: false },
      configuration: configurationStatus(stored.configuration),
    }
  })

  function usableBaiduCredentials(stored: StoredSyncState): Promise<StoredBaiduCredentials> {
    const previous = stored.credentials
    if (!previous) throw new Error('baidu_not_authenticated')
    if (previous.expiresAt - Date.now() > refreshBeforeExpiryMs) return Promise.resolve(previous)
    const configuration = stored.configuration
    if (!configuration) throw new Error('baidu_configuration_missing')
    if (refresh?.token === previous.refreshToken) return refresh.result
    const result = refreshBaiduCredentials(configuration, previous.refreshToken)
      .then(async (credentials) => {
        const latest = await store.update((current) => {
          if (current.credentials?.refreshToken !== previous.refreshToken) throw new Error('sync_target_changed')
          return { ...current, credentials: { ...credentials, profile: credentials.profile ?? previous.profile } }
        })
        if (!latest.credentials) throw new Error('baidu_not_authenticated')
        return latest.credentials
      })
      .finally(() => {
        if (refresh?.result === result) refresh = undefined
      })
    refresh = { token: previous.refreshToken, result }
    return result
  }

  async function markBaiduUsed(used: StoredBaiduCredentials): Promise<void> {
    await store.update((current) =>
      current.credentials?.accessToken === used.accessToken
        ? { ...current, credentials: { ...current.credentials, lastCallAt: Date.now() } }
        : current
    )
  }

  handle(
    SyncIpcChannels.WEBDAV_CONFIGURE,
    async (_event, input: WebDavConfigurationInput): Promise<WebDavConfigurationResult> => {
      try {
        const previous = (await store.load()).webdav
        const config = normalizeWebDavConfiguration(input, previous)
        await testWebDavConnection(config)
        const updated = await store.update((current) => {
          const target = current.webdav
          if (target?.id !== previous?.id || target?.password !== previous?.password)
            throw new Error('sync_target_changed')
          const sameTarget = target && config.url === target.url && config.username === target.username
          return {
            ...current,
            webdav: sameTarget ? { ...target, ...config } : { ...config, id: randomUUID() },
          }
        })
        return { success: true, preferences: readPreferences(updated) }
      } catch (error) {
        return { success: false, error: publicError(error, 'webdav_network_error') }
      }
    }
  )

  handle(SyncIpcChannels.PREFERENCES_GET, async (): Promise<SyncPreferences> => {
    return readPreferences(await store.load())
  })

  handle(SyncIpcChannels.PREFERENCES_SET, async (_event, update: SyncPreferencesUpdate): Promise<SyncPreferences> => {
    const updated = await store.update((stored) => {
      const current = { ...defaultPreferences, ...stored.preferences }
      const encryptionToken =
        update.encryptionToken === undefined ? stored.encryptionToken : update.encryptionToken.trim() || undefined
      const interval = update.intervalMinutes
      return {
        ...stored,
        encryptionToken,
        preferences: {
          ...current,
          enabled: typeof update.enabled === 'boolean' ? update.enabled : current.enabled,
          service: update.service === 'webdav' || update.service === 'baidu-netdisk' ? update.service : current.service,
          mode: update.mode === 'interval' || update.mode === 'window-close' ? update.mode : current.mode,
          intervalMinutes:
            typeof interval === 'number' && Number.isFinite(interval)
              ? Math.max(1, Math.min(1440, Math.round(interval)))
              : current.intervalMinutes,
          selection: isSyncSelection(update.selection) ? update.selection : current.selection,
          encryptionEnabled:
            typeof update.encryptionEnabled === 'boolean' ? update.encryptionEnabled : current.encryptionEnabled,
        },
      }
    })
    return readPreferences(updated)
  })

  handle(SyncIpcChannels.SYNC_RESULT, async (_event, result: SyncCompletion): Promise<SyncPreferences> => {
    const updated = await store.update((stored) => {
      assertTarget(stored, result.target)
      const history = { lastSyncAt: result.lastSyncAt, baseline: result.baseline }
      const preferences = { ...defaultPreferences, ...stored.preferences }
      if (result.restoredSelection) preferences.selection = result.restoredSelection
      if (result.target.service === 'webdav' && stored.webdav) {
        return { ...stored, preferences, webdav: { ...stored.webdav, ...history } }
      }
      return { ...stored, preferences: { ...preferences, ...history } }
    })
    return readPreferences(updated)
  })

  handle(SyncIpcChannels.CLOUD_DOWNLOAD, async (_event, target: SyncTarget): Promise<CloudDownloadResult> => {
    try {
      const stored = await store.load()
      assertTarget(stored, target)
      let downloaded: Awaited<ReturnType<typeof downloadCloud | typeof downloadWebDav>>
      if (target.service === 'webdav' && stored.webdav) {
        downloaded = await downloadWebDav(stored.webdav, stored.encryptionToken)
      } else {
        const credentials = await usableBaiduCredentials(stored)
        assertTarget(await store.load(), target)
        downloaded = await downloadCloud(credentials.accessToken, stored.encryptionToken)
        await markBaiduUsed(credentials)
      }
      assertTarget(await store.load(), target)
      return downloaded ? { success: true, exists: true, ...downloaded } : { success: true, exists: false }
    } catch (error) {
      return { success: false, error: publicError(error, 'cloud_download_failed') }
    }
  })

  handle(SyncIpcChannels.CLOUD_UPLOAD, async (_event, request: CloudUploadRequest): Promise<CloudUploadResult> => {
    try {
      const { target, expectedIdentity, payload } = request
      const stored = await store.load()
      assertTarget(stored, target)
      if (expectedIdentity && expectedIdentity.service !== target.service) throw new Error('sync_target_changed')
      const encrypt = Boolean(stored.preferences?.encryptionEnabled)
      if (target.service === 'webdav' && stored.webdav) {
        return {
          success: true,
          ...(await uploadWebDav(
            stored.webdav,
            payload,
            expectedIdentity?.service === 'webdav' ? expectedIdentity : undefined,
            encrypt,
            stored.encryptionToken
          )),
        }
      }
      const credentials = await usableBaiduCredentials(stored)
      assertTarget(await store.load(), target)
      const result = await uploadCloud(
        credentials.accessToken,
        payload,
        expectedIdentity?.service === 'baidu-netdisk' ? expectedIdentity : undefined,
        encrypt,
        stored.encryptionToken
      )
      await markBaiduUsed(credentials)
      return { success: true, ...result }
    } catch (error) {
      return { success: false, error: publicError(error, 'cloud_upload_failed') }
    }
  })
}
