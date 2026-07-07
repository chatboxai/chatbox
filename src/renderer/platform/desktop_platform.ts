import type { ElectronIPC } from '@shared/electron-types'
import type { Config, Settings, ShortcutSetting } from '@shared/types'
import { cache } from '@shared/utils/cache'
import localforage from 'localforage'
import { v4 as uuidv4 } from 'uuid'
import { parseLocale } from '@/i18n/parser'
import { getLogger } from '@/lib/utils'
import { type ImageGenerationStorage, IndexedDBImageGenerationStorage } from '@/storage/ImageGenerationStorage'
import { IndexedDBSessionMetaStorage, type SessionMetaStorage } from '@/storage/SessionMetaStorage'
import { IndexedDBTaskSessionStorage, type TaskSessionStorage } from '@/storage/TaskSessionStorage'
import { rememberFileNativePath } from '@/utils/file-native-path'
import { getOS } from '../packages/navigator'
import type { Platform, PlatformType } from './interfaces'
import DesktopKnowledgeBaseController from './knowledge-base/desktop-controller'
import DesktopSessionAttachmentRagController from './session-attachment-rag/desktop-controller'
import WebExporter from './web_exporter'
import { parseTextFileLocally } from './web_platform_utils'

const log = getLogger('desktop-platform')

const store = localforage.createInstance({ name: 'workspaicestore' })

export default class DesktopPlatform implements Platform {
  public type: PlatformType = 'desktop'

  public exporter = new WebExporter()

  private _kbController?: DesktopKnowledgeBaseController
  private _sessionAttachmentRagController?: DesktopSessionAttachmentRagController
  private _imageGenerationStorage: ImageGenerationStorage | null = null
  private _taskSessionStorage: TaskSessionStorage | null = null
  private _sessionMetaStorage: SessionMetaStorage | null = null

  public ipc: ElectronIPC
  constructor(ipc: ElectronIPC) {
    this.ipc = ipc
  }

  public getStorageType(): string {
    return 'INDEXEDDB'
  }

  public async getVersion() {
    return cache('ipc:getVersion', () => this.ipc.invoke('getVersion'), { ttl: 5 * 60 * 1000, memoryOnly: true })
  }
  public async getPlatform() {
    return cache('ipc:getPlatform', () => this.ipc.invoke('getPlatform'), { ttl: 5 * 60 * 1000 })
  }
  public async getArch() {
    return cache('ipc:getArch', () => this.ipc.invoke('getArch'), { ttl: 5 * 60 * 1000 })
  }
  public async shouldUseDarkColors(): Promise<boolean> {
    return await this.ipc.invoke('shouldUseDarkColors')
  }
  public onSystemThemeChange(callback: () => void): () => void {
    return this.ipc.onSystemThemeChange(callback)
  }
  public onWindowShow(callback: () => void): () => void {
    return this.ipc.onWindowShow(callback)
  }
  public onWindowFocused(callback: () => void): () => void {
    return this.ipc.onWindowFocused(callback)
  }
  public onNavigate(callback: (path: string) => void): () => void {
    return window.electronAPI.onNavigate(callback)
  }
  public async openLink(url: string): Promise<void> {
    return this.ipc.invoke('openLink', url)
  }
  public async getDeviceName(): Promise<string> {
    const deviceName = await cache('ipc:getDeviceName', () => this.ipc.invoke('getDeviceName'), {
      ttl: 5 * 60 * 1000,
    })
    return deviceName
  }
  public async getInstanceName(): Promise<string> {
    const deviceName = await this.getDeviceName()
    return `${deviceName} / ${getOS()}`
  }
  public async getLocale() {
    const locale = await cache('ipc:getLocale', () => this.ipc.invoke('getLocale'), { ttl: 5 * 60 * 1000 })
    return parseLocale(locale)
  }
  public async ensureShortcutConfig(config: ShortcutSetting): Promise<void> {
    return this.ipc.invoke('ensureShortcutConfig', JSON.stringify(config))
  }
  public async ensureProxyConfig(config: { proxy?: string }): Promise<void> {
    return this.ipc.invoke('ensureProxy', JSON.stringify(config))
  }
  public async relaunch(): Promise<void> {
    return this.ipc.invoke('relaunch')
  }

  public async getConfig(): Promise<Config> {
    return this.ipc.invoke('getConfig')
  }
  public async getSettings(): Promise<Settings> {
    return this.ipc.invoke('getSettings')
  }

  private needStoreInFile(key: string): boolean {
    return key === 'configs' || key === 'settings' || key === 'configVersion'
  }

  // biome-ignore lint/suspicious/noExplicitAny: implements the untyped Storage interface (heterogeneous JSON payloads)
  public async setStoreValue(key: string, value: any) {
    // 为什么序列化成 JSON？
    // 因为 IndexedDB 作为底层驱动时，可以直接存储对象，但是如果对象中包含函数或引用，将会直接报错
    let valueJson: string
    try {
      valueJson = JSON.stringify(value)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to serialize value for key "${key}": ${message}`)
    }
    if (this.needStoreInFile(key)) {
      return this.ipc.invoke('setStoreValue', key, valueJson)
    } else {
      await store.setItem(key, valueJson)
    }
  }
  public async getStoreValue(key: string) {
    if (this.needStoreInFile(key)) {
      return this.ipc.invoke('getStoreValue', key)
    } else {
      const json = await store.getItem<string>(key)
      if (!json) return null
      try {
        return JSON.parse(json)
      } catch (error) {
        console.error(`Failed to parse stored value for key "${key}":`, error)
        return null
      }
    }
  }
  public async delStoreValue(key: string) {
    if (this.needStoreInFile(key)) {
      return this.ipc.invoke('delStoreValue', key)
    } else {
      return await store.removeItem(key)
    }
  }
  // biome-ignore lint/suspicious/noExplicitAny: implements the untyped Storage interface (heterogeneous JSON payloads)
  public async getAllStoreValues(): Promise<{ [key: string]: any }> {
    // biome-ignore lint/suspicious/noExplicitAny: implements the untyped Storage interface (heterogeneous JSON payloads)
    const ret: { [key: string]: any } = {}
    await store.iterate((json, key) => {
      const value = typeof json === 'string' ? JSON.parse(json) : null
      ret[key] = value
    })
    const json = JSON.parse(await this.ipc.invoke('getAllStoreValues'))
    for (const [key, value] of Object.entries(json)) {
      if (this.needStoreInFile(key)) {
        ret[key] = value
      }
    }
    return ret
  }
  public async getAllStoreKeys(): Promise<string[]> {
    const keys = await store.keys()
    const ipcKeys: string[] = await this.ipc.invoke('getAllStoreKeys')
    return [...keys, ...ipcKeys]
  }
  // biome-ignore lint/suspicious/noExplicitAny: implements the untyped Storage interface (heterogeneous JSON payloads)
  public async setAllStoreValues(data: { [key: string]: any }): Promise<void> {
    for (const [key, value] of Object.entries(data)) {
      await this.setStoreValue(key, value)
    }
  }

  public async getStoreBlob(key: string): Promise<string | null> {
    return this.ipc.invoke('getStoreBlob', key)
  }
  public async setStoreBlob(key: string, value: string) {
    return this.ipc.invoke('setStoreBlob', key, value)
  }
  public async delStoreBlob(key: string) {
    return this.ipc.invoke('delStoreBlob', key)
  }
  public async listStoreBlobKeys(): Promise<string[]> {
    return this.ipc.invoke('listStoreBlobKeys')
  }

  public async shouldShowAboutDialogWhenStartUp(): Promise<boolean> {
    return cache('ipc:shouldShowAboutDialogWhenStartUp', () => this.ipc.invoke('shouldShowAboutDialogWhenStartUp'), {
      ttl: 30 * 1000,
    })
  }

  public async appLog(level: string, message: string) {
    return this.ipc.invoke('appLog', JSON.stringify({ level, message }))
  }

  public async exportLogs(): Promise<string> {
    return this.ipc.invoke('exportLogs')
  }

  public async clearLogs(): Promise<void> {
    return this.ipc.invoke('clearLogs')
  }

  public async ensureAutoLaunch(enable: boolean) {
    return this.ipc.invoke('ensureAutoLaunch', enable)
  }

  async parseFileLocally(file: File): Promise<{ key?: string; isSupported: boolean }> {
    let result: { text: string; isSupported: boolean }
    const filePath = this.getLocalFilePath(file)
    if (!filePath) {
      // 复制长文本粘贴的文件是没有 path 的
      result = await parseTextFileLocally(file)
    } else {
      const resultJSON = await this.ipc.invoke('parseFileLocally', JSON.stringify({ filePath }))
      result = JSON.parse(resultJSON)
    }
    if (!result.isSupported) {
      log.error(`parseFileLocally: unsupported file "${file.name}" (path=${filePath || 'none'})`)
      return { isSupported: false }
    }
    const key = `parseFile-` + uuidv4()
    await this.setStoreBlob(key, result.text)
    return { key, isSupported: true }
  }

  getLocalFilePath(file: File): string {
    return rememberFileNativePath(file, this.ipc.getPathForFile(file))
  }

  async readLocalFileContent(filePath: string): Promise<string | null> {
    const resultJSON = await this.ipc.invoke('parseFileLocally', JSON.stringify({ filePath }))
    const result = JSON.parse(resultJSON)
    if (!result.isSupported) {
      return null
    }
    return result.text || null
  }

  async parseFileWithMineru(
    file: File,
    apiToken: string
  ): Promise<{ success: boolean; content?: string; error?: string; cancelled?: boolean }> {
    const filePath = this.getLocalFilePath(file)
    if (!filePath) {
      // Files without path (e.g., pasted files) are not supported for MinerU parsing
      return { success: false, error: 'File path is required for MinerU parsing' }
    }

    return this.ipc.invoke('parser:parse-file-with-mineru', {
      filePath,
      filename: file.name,
      mimeType: file.type,
      apiToken,
    })
  }

  async cancelMineruParse(filePath: string): Promise<{ success: boolean; error?: string }> {
    return this.ipc.invoke('parser:cancel-mineru-parse', filePath)
  }

  public async parseUrl(url: string): Promise<{ key: string; title: string }> {
    const json = await this.ipc.invoke('parseUrl', url)
    return JSON.parse(json)
  }

  public async isFullscreen() {
    return this.ipc.invoke('isFullscreen')
  }

  public async setFullscreen(enabled: boolean) {
    return this.ipc.invoke('setFullscreen', enabled)
  }

  public async switchTheme(theme: 'dark' | 'light') {
    return this.ipc.invoke('switch-theme', theme)
  }

  public getKnowledgeBaseController() {
    if (!this._kbController) {
      this._kbController = new DesktopKnowledgeBaseController(this.ipc)
    }
    return this._kbController
  }

  public getSessionAttachmentRagController() {
    if (!this._sessionAttachmentRagController) {
      this._sessionAttachmentRagController = new DesktopSessionAttachmentRagController(this.ipc)
    }
    return this._sessionAttachmentRagController
  }

  public getImageGenerationStorage(): ImageGenerationStorage {
    if (!this._imageGenerationStorage) {
      this._imageGenerationStorage = new IndexedDBImageGenerationStorage()
    }
    return this._imageGenerationStorage
  }

  public getTaskSessionStorage(): TaskSessionStorage {
    if (!this._taskSessionStorage) {
      this._taskSessionStorage = new IndexedDBTaskSessionStorage()
    }
    return this._taskSessionStorage
  }

  public getSessionMetaStorage(): SessionMetaStorage {
    if (!this._sessionMetaStorage) {
      this._sessionMetaStorage = new IndexedDBSessionMetaStorage()
    }
    return this._sessionMetaStorage
  }

  // Cross-session full-text search index (main-process FTS5, FABLE F4)
  public chatSearchUpsertSession(sessionId: string, entries: { messageId: string; text: string }[]): Promise<void> {
    return this.ipc.invoke('chat-search:upsert-session', { sessionId, entries })
  }

  public chatSearchDeleteSessions(sessionIds: string[]): Promise<void> {
    return this.ipc.invoke('chat-search:delete-sessions', { sessionIds })
  }

  public chatSearchQuery(query: string, limit?: number): Promise<{ sessionId: string; messageId: string }[]> {
    return this.ipc.invoke('chat-search:query', { query, limit })
  }

  public chatSearchGetMeta(key: string): Promise<string | null> {
    return this.ipc.invoke('chat-search:get-meta', { key })
  }

  public chatSearchSetMeta(key: string, value: string): Promise<void> {
    return this.ipc.invoke('chat-search:set-meta', { key, value })
  }

  public chatSearchClear(): Promise<void> {
    return this.ipc.invoke('chat-search:clear')
  }

  public async sandboxInit(config: { workingDirectory: string }) {
    return this.ipc.invoke('sandbox:init', config)
  }

  public async sandboxExec(params: { command: string; timeout?: number }) {
    return this.ipc.invoke('sandbox:exec', params)
  }

  public async sandboxRead(params: { filePath: string }) {
    return this.ipc.invoke('sandbox:read', params)
  }

  public async sandboxWrite(params: { filePath: string; content: string }) {
    return this.ipc.invoke('sandbox:write', params)
  }

  public async sandboxEdit(params: { filePath: string; search: string; replace: string }) {
    return this.ipc.invoke('sandbox:edit', params)
  }

  public async sandboxLs(params: { dirPath: string }) {
    return this.ipc.invoke('sandbox:ls', params)
  }

  public async sandboxGrep(params: { pattern: string; dirPath?: string; include?: string }) {
    return this.ipc.invoke('sandbox:grep', params)
  }

  public async sandboxFind(params: { dirPath: string; pattern?: string }) {
    return this.ipc.invoke('sandbox:find', params)
  }

  public async sandboxKill() {
    return this.ipc.invoke('sandbox:kill')
  }

  public async sandboxReset() {
    return this.ipc.invoke('sandbox:reset')
  }

  public async sandboxStatus() {
    return this.ipc.invoke('sandbox:status')
  }

  public async sandboxCheckAvailability() {
    return this.ipc.invoke('sandbox:check-availability')
  }

  public async openDirectoryDialog() {
    return this.ipc.invoke('dialog:openDirectory')
  }

  public minimize() {
    return this.ipc.invoke('window:minimize')
  }

  public maximize() {
    return this.ipc.invoke('window:maximize')
  }

  public unmaximize() {
    return this.ipc.invoke('window:unmaximize')
  }

  public closeWindow() {
    return this.ipc.invoke('window:close')
  }

  public isMaximized() {
    return this.ipc.invoke('window:is-maximized')
  }

  public onMaximizedChange(callback: (isMaximized: boolean) => void): () => void {
    const unsubscribe = this.ipc.onWindowMaximizedChanged((_, isMaximized) => {
      callback(isMaximized)
    })

    return unsubscribe
  }
}
