import type { Config, Language, Settings, ShortcutSetting } from '@shared/types'
import type { ImageGenerationStorage } from '@/storage/ImageGenerationStorage'
import type { SessionMetaStorage } from '@/storage/SessionMetaStorage'
import type { TaskSessionStorage } from '@/storage/TaskSessionStorage'
import type { KnowledgeBaseController } from './knowledge-base/interface'
import type { SessionAttachmentRagController } from './session-attachment-rag/interface'

export type PlatformType = 'desktop'

export interface Storage {
  getStorageType(): string
  // biome-ignore lint/suspicious/noExplicitAny: the store holds heterogeneous JSON payloads; callers narrow per key
  setStoreValue(key: string, value: any): Promise<void>
  // biome-ignore lint/suspicious/noExplicitAny: the store holds heterogeneous JSON payloads; callers narrow per key
  getStoreValue(key: string): Promise<any>
  delStoreValue(key: string): Promise<void>
  // biome-ignore lint/suspicious/noExplicitAny: the store holds heterogeneous JSON payloads; callers narrow per key
  getAllStoreValues(): Promise<{ [key: string]: any }>
  getAllStoreKeys(): Promise<string[]>
  // biome-ignore lint/suspicious/noExplicitAny: the store holds heterogeneous JSON payloads; callers narrow per key
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
  onWindowFocused(callback: () => void): () => void
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
  // 通知

  shouldShowAboutDialogWhenStartUp(): Promise<boolean>

  appLog(level: string, message: string): Promise<void>

  // 日志导出与管理
  exportLogs(): Promise<string> // 返回日志内容
  clearLogs(): Promise<void> // 清空日志

  ensureAutoLaunch(enable: boolean): Promise<void>

  parseFileLocally(file: File): Promise<{ key?: string; isSupported: boolean }>
  getLocalFilePath(file: File): string
  readLocalFileContent?(filePath: string): Promise<string | null>

  // Parse file using MinerU service (Desktop only)
  parseFileWithMineru?(
    file: File,
    apiToken: string
  ): Promise<{ success: boolean; content?: string; error?: string; cancelled?: boolean }>

  // Cancel MinerU parsing task (Desktop only)
  cancelMineruParse?(filePath: string): Promise<{ success: boolean; error?: string }>

  // parseUrl(url: string): Promise<{ key: string, title: string }>

  isFullscreen(): Promise<boolean>
  setFullscreen(enabled: boolean): Promise<void>

  getKnowledgeBaseController(): KnowledgeBaseController
  getSessionAttachmentRagController(): SessionAttachmentRagController

  // Cross-session full-text search index (main-process FTS5, FABLE F4)
  chatSearchUpsertSession(sessionId: string, entries: { messageId: string; text: string }[]): Promise<void>
  chatSearchDeleteSessions(sessionIds: string[]): Promise<void>
  chatSearchQuery(query: string, limit?: number): Promise<{ sessionId: string; messageId: string }[]>
  chatSearchGetMeta(key: string): Promise<string | null>
  chatSearchSetMeta(key: string, value: string): Promise<void>
  chatSearchClear(): Promise<void>

  getImageGenerationStorage(): ImageGenerationStorage

  getTaskSessionStorage(): TaskSessionStorage

  getSessionMetaStorage(): SessionMetaStorage

  // Sandbox operations (Desktop only)
  sandboxInit?(config: { workingDirectory: string }): Promise<{ success: boolean; error?: string }>
  sandboxExec?(params: {
    command: string
    timeout?: number
  }): Promise<{ stdout: string; stderr: string; exitCode: number }>
  sandboxRead?(params: { filePath: string }): Promise<{ success: boolean; content?: string; error?: string }>
  sandboxWrite?(params: { filePath: string; content: string }): Promise<{ success: boolean; error?: string }>
  sandboxEdit?(params: {
    filePath: string
    search: string
    replace: string
  }): Promise<{ success: boolean; error?: string }>
  sandboxLs?(params: { dirPath: string }): Promise<{ success: boolean; content?: string; error?: string }>
  sandboxGrep?(params: {
    pattern: string
    dirPath?: string
    include?: string
  }): Promise<{ success: boolean; content?: string; error?: string }>
  sandboxFind?(params: {
    dirPath: string
    pattern?: string
  }): Promise<{ success: boolean; content?: string; error?: string }>
  sandboxKill?(): Promise<{ killed: boolean }>
  sandboxReset?(): Promise<{ success: boolean; error?: string }>
  sandboxStatus?(): Promise<{ state: string; workingDirectory?: string | null; platform?: string }>
  sandboxCheckAvailability?(): Promise<{ available: boolean; reason?: string }>

  // Directory dialog (Desktop only)
  openDirectoryDialog?(): Promise<{ canceled: boolean; path?: string }>

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
