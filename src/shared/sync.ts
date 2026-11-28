export const SyncIpcChannels = {
  BAIDU_LOGIN: 'sync:baidu-login',
  BAIDU_CANCEL_LOGIN: 'sync:baidu-cancel-login',
  BAIDU_STATUS: 'sync:baidu-status',
  BAIDU_LOGOUT: 'sync:baidu-logout',
  WEBDAV_CONFIGURE: 'sync:webdav-configure',
  READ_SAVED_SECRET: 'sync:read-saved-secret',
  PREFERENCES_GET: 'sync:preferences-get',
  PREFERENCES_SET: 'sync:preferences-set',
  CLOUD_DOWNLOAD: 'sync:cloud-download',
  CLOUD_UPLOAD: 'sync:cloud-upload',
  SYNC_RESULT: 'sync:result',
  WINDOW_CLOSE_READY: 'sync:window-close-ready',
  WINDOW_CLOSE_REQUESTED: 'sync:window-close-requested',
  WINDOW_CLOSE_COMPLETE: 'sync:window-close-complete',
} as const

export type SyncMode = 'interval' | 'window-close'
export type SyncService = 'baidu-netdisk' | 'webdav'
export const maxSyncArchiveBytes = 128 * 1024 * 1024
export const baiduRedirectUri = 'http://127.0.0.1:1456/auth/callback'
export type SyncTarget = { service: 'baidu-netdisk' } | { service: 'webdav'; id: string }
export type SavedSyncSecret =
  | { kind: 'baidu-secret-key'; clientId: string }
  | { kind: 'webdav-password'; id: string }
  | { kind: 'encryption-token' }
export interface WebDavConfigurationInput {
  url: string
  username: string
  password?: string
}
export interface WebDavConfigurationStatus {
  id: string
  url: string
  username: string
  passwordConfigured: boolean
}
export type WebDavConfigurationResult =
  | { success: true; preferences: SyncPreferences }
  | { success: false; error: string }
export interface SyncSelection {
  sessions: boolean
  settings: boolean
  copilots: boolean
  credentials: boolean
}

export function syncSelectionKey(selection: SyncSelection): string {
  return [selection.sessions, selection.settings, selection.copilots, selection.credentials].map(Number).join('')
}

export function isSyncSelection(value: unknown): value is SyncSelection {
  if (!value || typeof value !== 'object') return false
  const selection = value as Partial<SyncSelection>
  return (
    typeof selection.sessions === 'boolean' &&
    typeof selection.settings === 'boolean' &&
    typeof selection.copilots === 'boolean' &&
    typeof selection.credentials === 'boolean'
  )
}
export interface SyncBaseline {
  cloudRevision?: string
  localFingerprint?: string
  selectionKey?: string
}
export interface SyncPreferences {
  enabled: boolean
  service: SyncService
  mode: SyncMode
  intervalMinutes: number
  selection: SyncSelection
  encryptionEnabled: boolean
  encryptionTokenConfigured: boolean
  lastSyncAt?: number
  baseline?: SyncBaseline
  webdav?: WebDavConfigurationStatus
}
export interface SyncPreferencesUpdate
  extends Partial<
    Pick<SyncPreferences, 'enabled' | 'service' | 'mode' | 'intervalMinutes' | 'selection' | 'encryptionEnabled'>
  > {
  encryptionToken?: string
}
export interface BaiduFileIdentity {
  service: 'baidu-netdisk'
  fsId: number
  md5?: string
  serverMtime?: number
}
export interface WebDavFileIdentity {
  service: 'webdav'
  etag?: string
}
export type CloudFileIdentity = BaiduFileIdentity | WebDavFileIdentity
export interface CloudSyncPayload {
  revision: string
  parentRevision?: string
  deviceId: string
  updatedAt: number
  selection: SyncSelection
  contentFingerprint: string
  backup: Uint8Array
}
export interface CloudDownloadResult {
  success: boolean
  exists?: boolean
  payload?: CloudSyncPayload
  identity?: CloudFileIdentity
  error?: string
}
export interface CloudUploadRequest {
  target: SyncTarget
  payload: CloudSyncPayload
  expectedIdentity?: CloudFileIdentity
}
export interface SyncCompletion {
  target: SyncTarget
  lastSyncAt: number
  baseline: SyncBaseline
  restoredSelection?: SyncSelection
}
export interface CloudUploadResult {
  success: boolean
  conflict?: boolean
  identity?: CloudFileIdentity
  error?: string
}

export interface BaiduAccountStatus {
  authenticated: boolean
  userId?: string
  displayName?: string
  avatarUrl?: string
  expiresAt?: number
  lastCallAt?: number
}

export interface BaiduConfigurationStatus {
  clientId?: string
  clientSecretConfigured: boolean
}

export interface BaiduLoginRequest {
  clientId: string
  clientSecret?: string
}

export interface BaiduAccountResult {
  success: boolean
  account?: BaiduAccountStatus
  configuration?: BaiduConfigurationStatus
  error?: string
}

export interface DesktopSyncApi {
  getBaiduAccount(): Promise<BaiduAccountResult>
  signInToBaidu(request: BaiduLoginRequest): Promise<BaiduAccountResult>
  cancelBaiduLogin(): Promise<BaiduAccountResult>
  signOutOfBaidu(): Promise<BaiduAccountResult>
  configureWebDav(input: WebDavConfigurationInput): Promise<WebDavConfigurationResult>
  readSavedSecret(request: SavedSyncSecret): Promise<string>
  getPreferences(): Promise<SyncPreferences>
  setPreferences(update: SyncPreferencesUpdate): Promise<SyncPreferences>
  download(target: SyncTarget): Promise<CloudDownloadResult>
  upload(request: CloudUploadRequest): Promise<CloudUploadResult>
  recordCompletion(completion: SyncCompletion): Promise<SyncPreferences>
  setWindowCloseReady(ready: boolean): Promise<void>
  onWindowCloseRequested(callback: () => void): () => void
  completeWindowClose(): Promise<void>
}

export const defaultSyncPreferences: SyncPreferences = {
  enabled: false,
  service: 'baidu-netdisk',
  mode: 'interval',
  intervalMinutes: 30,
  selection: { sessions: true, settings: true, copilots: true, credentials: false },
  encryptionEnabled: false,
  encryptionTokenConfigured: false,
}
