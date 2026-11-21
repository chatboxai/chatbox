import type { SyncBaseline, SyncPreferences } from '../../shared/sync'

export interface WebDavConfiguration {
  url: string
  username: string
  password: string
}

export interface StoredWebDavTarget extends WebDavConfiguration {
  id: string
  lastSyncAt?: number
  baseline?: SyncBaseline
}

export interface BaiduProfile {
  userId?: string
  displayName?: string
  avatarUrl?: string
  vipType?: number
}

export interface BaiduAppConfiguration {
  clientId: string
  clientSecret: string
  scope: string
}

export interface StoredBaiduCredentials {
  accessToken: string
  refreshToken: string
  scope?: string
  expiresAt: number
  profile?: BaiduProfile
  lastCallAt: number
}

export interface StoredSyncState {
  configuration?: BaiduAppConfiguration
  credentials?: StoredBaiduCredentials
  preferences?: Omit<SyncPreferences, 'encryptionTokenConfigured' | 'service' | 'webdav'> & {
    service?: SyncPreferences['service']
  }
  webdav?: StoredWebDavTarget
  encryptionToken?: string
  deviceId?: string
}
