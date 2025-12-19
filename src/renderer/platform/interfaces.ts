/** biome-ignore-all lint/suspicious/noExplicitAny: <any> */
import type { Config, Language, Settings, ShortcutSetting } from 'src/shared/types'
import type { KnowledgeBaseController } from './knowledge-base/interface'

export type PlatformType = 'web' | 'desktop' | 'mobile'

export interface Storage {
  getStorageType(): string
  setStoreValue(key: string, value: any): Promise<void>
  getStoreValue(key: string): Promise<any>
  delStoreValue(key: string): Promise<void>
  getAllStoreValues(): Promise<{ [key: string]: any }>
  getAllStoreKeys(): Promise<string[]>
  setAllStoreValues(data: { [key: string]: any }): Promise<void>
}

export interface Platform extends Storage {
  type: PlatformType

  exporter: Exporter

  // 系统相关

  getVersion(): Promise<string>
  getPlatform(): Promise<string>
  getArch(): Promise<string>
  shouldUseDarkColors(): Promise<boolean>
  onSystemThemeChange(callback: () => void): () => void
  onWindowShow(callback: () => void): () => void
  onUpdateDownloaded(callback: () => void): () => void
  onNavigate?(callback: (path: string) => void): () => void
  openLink(url: string): Promise<void>
  getDeviceName(): Promise<string>
  getInstanceName(): Promise<string>
  getLocale(): Promise<Language>
  ensureShortcutConfig(config: ShortcutSetting): Promise<void>
  ensureProxyConfig(config: { proxy?: string }): Promise<void>
  relaunch(): Promise<void>

  // 数据配置

  getConfig(): Promise<Config>
  getSettings(): Promise<Settings>

  // Blob 存储

  getStoreBlob(key: string): Promise<string | null>
  setStoreBlob(key: string, value: string): Promise<void>
  delStoreBlob(key: string): Promise<void>
  listStoreBlobKeys(): Promise<string[]>

  // 追踪

  initTracking(): void
  trackingEvent(name: string, params: { [key: string]: string }): void

  // 通知
  shouldShowAboutDialogWhenStartUp(): Promise<boolean>

  appLog(level: string, message: string): Promise<void>

  ensureAutoLaunch(enable: boolean): Promise<void>

  parseFileLocally(file: File): Promise<{ key?: string; isSupported: boolean }>

  // parseUrl(url: string): Promise<{ key: string, title: string }>

  isFullscreen(): Promise<boolean>
  setFullscreen(enabled: boolean): Promise<void>
  installUpdate(): Promise<void>

  getKnowledgeBaseController(): KnowledgeBaseController

  // window controls
  minimize(): Promise<void>

  maximize(): Promise<void>

  unmaximize(): Promise<void>

  closeWindow(): Promise<void>

  isMaximized(): Promise<boolean>

  onMaximizedChange(callback: (isMaximized: boolean) => void): () => void
}

export interface Exporter {
  exportBlob: (filename: string, blob: Blob, encoding?: 'utf8' | 'ascii' | 'utf16') => Promise<void>
  exportTextFile: (filename: string, content: string) => Promise<void>
  exportImageFile: (basename: string, base64: string) => Promise<void>
  exportByUrl: (filename: string, url: string) => Promise<void>
  exportStreamingJson: (filename: string, dataCallback: () => AsyncGenerator<string, void, unknown>) => Promise<void>
}
