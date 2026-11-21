import {
  type CloudFileIdentity,
  type DesktopSyncApi,
  defaultSyncPreferences,
  type SavedSyncSecret,
  type SyncPreferences,
  type SyncPreferencesUpdate,
  type SyncSelection,
  type SyncTarget,
  type WebDavConfigurationInput,
} from '@shared/sync'
import { rendererBackupService } from '@/app/renderer-backup'
import { syncBackupSource } from '@/app/renderer-sync-backup'
import platform from '@/platform'
import { fingerprintBackup } from './fingerprint'
import { decideSyncAction } from './strategy'

type Trigger = 'startup' | 'interval' | 'window-close' | 'manual'

interface RuntimeState {
  preferences: SyncPreferences
  loaded: boolean
  running: boolean
  completed?: boolean
  error?: string
}

let state: RuntimeState = { preferences: defaultSyncPreferences, loaded: false, running: false }
const listeners = new Set<() => void>()
let initializePromise: Promise<void> | undefined
let activeSync: Promise<void> | undefined
let timer: ReturnType<typeof setTimeout> | undefined

function desktopSync(): DesktopSyncApi {
  if (!platform.sync) throw new Error('sync_unavailable')
  return platform.sync
}

function publish(next: Partial<RuntimeState>) {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

function selectionKey(selection: SyncSelection) {
  return [selection.sessions, selection.settings, selection.copilots, selection.credentials].map(Number).join('')
}

function deviceId() {
  const key = 'chatany-sync-device-id'
  const saved = localStorage.getItem(key)
  if (saved) return saved
  const id = crypto.randomUUID()
  localStorage.setItem(key, id)
  return id
}

async function upload(
  api: DesktopSyncApi,
  target: SyncTarget,
  backup: Uint8Array,
  fingerprint: string,
  selection: SyncSelection,
  parentRevision?: string,
  identity?: CloudFileIdentity
) {
  const revision = crypto.randomUUID()
  const result = await api.upload({
    target,
    payload: {
      revision,
      parentRevision,
      deviceId: deviceId(),
      updatedAt: Date.now(),
      selection,
      contentFingerprint: fingerprint,
      backup,
    },
    expectedIdentity: identity,
  })
  if (!result.success) throw new Error(result.error || 'cloud_upload_failed')
  if (!result.conflict) return revision
}

async function syncAttempt(api: DesktopSyncApi, preferences: SyncPreferences, target: SyncTarget) {
  const downloaded = await api.download(target)
  if (!downloaded.success) throw new Error(downloaded.error || 'cloud_download_failed')
  let selection = preferences.selection
  const local = await rendererBackupService.exportForSync(selection)
  let localFingerprint = await fingerprintBackup(local.bytes)
  const cloud = downloaded.payload
  let cloudRevision = cloud?.revision
  let restoredSelection: SyncSelection | undefined

  if (!cloud) {
    cloudRevision = await upload(api, target, local.bytes, localFingerprint, selection)
  } else {
    const action = decideSyncAction({
      baseline: preferences.baseline,
      selectionKey: selectionKey(selection),
      localFingerprint,
      cloudRevision: cloud.revision,
    })
    if (action === 'upload-local') {
      cloudRevision = await upload(
        api,
        target,
        local.bytes,
        localFingerprint,
        selection,
        cloud.revision,
        downloaded.identity
      )
    } else if (action === 'replace-local-from-cloud') {
      if ((await fingerprintBackup(cloud.backup)) !== cloud.contentFingerprint) {
        throw new Error('unsupported_cloud_sync_payload')
      }
      selection = cloud.selection
      await rendererBackupService.replaceForSync(syncBackupSource(cloud.backup), selection)
      restoredSelection = selection
      const restored = await rendererBackupService.exportForSync(selection)
      localFingerprint = await fingerprintBackup(restored.bytes)
    }
  }

  if (!cloudRevision) return false
  const updated = await api.recordCompletion({
    target,
    lastSyncAt: Date.now(),
    baseline: { cloudRevision, localFingerprint, selectionKey: selectionKey(selection) },
    restoredSelection,
  })
  publish({ preferences: updated, completed: true })
  return true
}

async function performSync(trigger: Trigger) {
  const api = desktopSync()
  const preferences = await api.getPreferences()
  publish({ preferences })
  if (!preferences.enabled || (trigger === 'window-close' && preferences.mode !== 'window-close')) return
  const { service, webdav, encryptionEnabled, encryptionTokenConfigured, selection } = preferences
  if (service === 'webdav' && !webdav) throw new Error('webdav_not_configured')
  if (encryptionEnabled && !encryptionTokenConfigured) throw new Error('encryption_token_required')
  if (!Object.values(selection).some(Boolean)) throw new Error('sync_selection_required')
  const target: SyncTarget = service === 'webdav' && webdav ? { service, id: webdav.id } : { service: 'baidu-netdisk' }
  await api.setWindowCloseReady(true)
  if (await syncAttempt(api, preferences, target)) return

  const latest = await api.getPreferences()
  if (
    !latest.enabled ||
    latest.service !== service ||
    (target.service === 'webdav' && latest.webdav?.id !== target.id)
  ) {
    throw new Error('sync_target_changed')
  }
  if (!(await syncAttempt(api, latest, target))) throw new Error('cloud_changed_during_sync')
}

function showError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  const code = message.match(/(?:^|Error: )([a-z][a-z_]+(?::\d+)?)$/)?.[1]
  publish({ error: code ?? 'sync_failed', completed: false })
}

async function updateCloseReadiness() {
  const { preferences, running } = state
  await desktopSync().setWindowCloseReady(running || (preferences.enabled && preferences.mode === 'window-close'))
}

export function syncNow(trigger: Trigger = 'manual'): Promise<void> {
  if (activeSync) return activeSync
  publish({ running: true, error: undefined, completed: false })
  activeSync = performSync(trigger)
    .catch((error) => {
      showError(error)
      throw error
    })
    .finally(() => {
      activeSync = undefined
      publish({ running: false })
      schedule()
      void updateCloseReadiness().catch(showError)
    })
  return activeSync
}

function schedule() {
  if (timer) clearTimeout(timer)
  const { preferences, loaded, running } = state
  if (loaded && !running && preferences.enabled && preferences.mode === 'interval') {
    timer = setTimeout(() => {
      void syncNow('interval').catch(() => undefined)
    }, preferences.intervalMinutes * 60_000)
  }
}

export async function saveSyncPreferences(update: SyncPreferencesUpdate): Promise<void> {
  try {
    const preferences = await desktopSync().setPreferences(update)
    publish({ preferences, error: undefined, ...(update.service && { completed: false }) })
    await updateCloseReadiness()
    schedule()
  } catch (error) {
    showError(error)
    throw error
  }
}

export async function configureWebDav(input: WebDavConfigurationInput): Promise<void> {
  const result = await desktopSync().configureWebDav(input)
  if (!result.success) throw new Error(result.error)
  publish({ preferences: result.preferences, error: undefined, completed: false })
  schedule()
}

export function readSavedSyncSecret(request: SavedSyncSecret): Promise<string> {
  return Promise.resolve().then(() => desktopSync().readSavedSecret(request))
}

export function initializeSyncRuntime(): Promise<void> {
  if (initializePromise) return initializePromise
  const api = platform.sync
  if (!api) return Promise.resolve()
  api.onWindowCloseRequested(() => {
    void syncNow('window-close')
      .catch(() => undefined)
      .finally(() => api.completeWindowClose())
      .catch(showError)
  })
  initializePromise = api
    .getPreferences()
    .then(async (preferences) => {
      publish({ preferences, loaded: true })
      await updateCloseReadiness()
      schedule()
      if (preferences.enabled) {
        setTimeout(() => {
          void syncNow('startup').catch(() => undefined)
        }, 3000)
      }
    })
    .catch((error) => {
      publish({ loaded: true })
      showError(error)
    })
  return initializePromise
}

export const syncRuntime = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot() {
    return state
  },
}
