export type RuntimePlatform = 'ios' | 'android' | 'desktop' | 'web' | 'unknown'

export interface KeyValueStoragePort {
  get<T = unknown>(key: string): Promise<T | null>
  set<T = unknown>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
  keys(): Promise<string[]>
}

export interface BlobStoragePort {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
  keys(): Promise<string[]>
}

export interface DevicePort {
  platform(): Promise<RuntimePlatform>
  version(): Promise<string>
  deviceName(): Promise<string>
  locale(): Promise<string>
  prefersDarkColorScheme(): Promise<boolean>
}

export interface LinkPort {
  openExternal(url: string): Promise<void>
}

export interface NetworkPort {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export interface AnalyticsPort {
  init(): Promise<void> | void
  event(name: string, params: Record<string, string>): Promise<void> | void
}

export interface LoggerPort {
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string): Promise<void> | void
}

export interface FileExportPort {
  exportBlob(filename: string, blob: Blob, encoding?: 'utf8' | 'ascii' | 'utf16'): Promise<void>
  exportTextFile(filename: string, content: string): Promise<void>
  exportImageFile(basename: string, base64: string): Promise<void>
  exportByUrl(filename: string, url: string): Promise<void>
}

export interface CoreRuntimePorts {
  keyValueStorage: KeyValueStoragePort
  blobStorage: BlobStoragePort
  device: DevicePort
  link: LinkPort
  network: NetworkPort
  analytics?: AnalyticsPort
  logger?: LoggerPort
  fileExport?: FileExportPort
}

export type { SessionDataRepositoryPort, SessionMetaRepositoryPort, SessionRepositoryPort } from './session-repository'
export type { FolderRepositoryPort } from './folder-repository'
