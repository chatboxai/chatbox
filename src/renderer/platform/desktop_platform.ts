/** biome-ignore-all lint/suspicious/noExplicitAny: <any> */

import type { AnalyticsEventParams } from '@shared/analytics'
import type { ElectronIPC } from '@shared/electron-types'
import type {
  SandboxExecLanguage,
  SandboxExecResult,
  SandboxOperationResult,
  SandboxReadResult,
} from '@shared/sandbox-provider'
import type { Config, Settings, ShortcutSetting } from '@shared/types'
import type { WorkspaceInstructionsResult } from '@shared/types/workspace-instructions'
import { cache } from '@shared/utils/cache'
import localforage from 'localforage'
import { v4 as uuidv4 } from 'uuid'
import { parseLocale } from '@/i18n/parser'
import { getLogger } from '@/lib/utils'
import { type ImageGenerationStorage, IndexedDBImageGenerationStorage } from '@/storage/ImageGenerationStorage'
import { IndexedDBSessionMetaStorage, type SessionMetaStorage } from '@/storage/SessionMetaStorage'
import { rememberFileNativePath } from '@/utils/file-native-path'
import { getOS } from '../packages/navigator'
import type { Platform, PlatformType } from './interfaces'
import DesktopKnowledgeBaseController from './knowledge-base/desktop-controller'
import DesktopSessionAttachmentRagController from './session-attachment-rag/desktop-controller'
import WebExporter from './web_exporter'
import { parseTextFileLocally } from './web_platform_utils'

const log = getLogger('desktop-platform')

const store = localforage.createInstance({ name: 'chatboxstore' })

export default class DesktopPlatform implements Platform {
  public type: PlatformType = 'desktop'
  public readonly isDesktopLike = true

  public exporter = new WebExporter()

  private _kbController?: DesktopKnowledgeBaseController
  private _sessionAttachmentRagController?: DesktopSessionAttachmentRagController
  private _imageGenerationStorage: ImageGenerationStorage | null = null
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
  public async isWindowFocused(): Promise<boolean> {
    return this.ipc.invoke('window:is-focused')
  }
  public onUpdateDownloaded(callback: () => void): () => void {
    return this.ipc.onUpdateDownloaded(callback)
  }
  public onUpdaterChecking(callback: () => void): () => void {
    return this.ipc.onUpdaterChecking(callback)
  }
  public onUpdaterAvailable(callback: (data: { version: string }) => void): () => void {
    return this.ipc.onUpdaterAvailable(callback)
  }
  public onUpdaterNotAvailable(callback: () => void): () => void {
    return this.ipc.onUpdaterNotAvailable(callback)
  }
  public onUpdaterProgress(
    callback: (data: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void
  ): () => void {
    return this.ipc.onUpdaterProgress(callback)
  }
  public onUpdaterDownloaded(callback: (data: { version: string }) => void): () => void {
    return this.ipc.onUpdaterDownloaded(callback)
  }
  public onUpdaterError(callback: (data: { message: string }) => void): () => void {
    return this.ipc.onUpdaterError(callback)
  }
  public async checkForUpdate(): Promise<{ started: boolean }> {
    return this.ipc.invoke('updater:check')
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
  public async getAllStoreValues(): Promise<{ [key: string]: any }> {
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

  public initTracking(): void {
    // Desktop events are sent through the main-process Measurement Protocol bridge.
  }
  public async trackingEvent(name: string, params: AnalyticsEventParams): Promise<void> {
    const chatboxPlatform = await this.getPlatform()
    const dataJson = JSON.stringify({
      name,
      params: {
        ...params,
        chatbox_platform_type: 'desktop',
        chatbox_platform: chatboxPlatform,
      },
    })
    await this.ipc.invoke('analysticTrackingEvent', dataJson)
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

  async parseFileLocally(file: File): Promise<{ key?: string; isSupported: boolean; errorCode?: string }> {
    let result: { text: string; isSupported: boolean; errorCode?: string }
    const filePath = this.getLocalFilePath(file)
    if (!filePath) {
      // 复制长文本粘贴的文件是没有 path 的
      result = await parseTextFileLocally(file)
    } else {
      const resultJSON = await this.ipc.invoke('parseFileLocally', JSON.stringify({ filePath }))
      result = JSON.parse(resultJSON)
    }
    if (!result.isSupported) {
      log.error(
        `parseFileLocally: unsupported file "${file.name}" (path=${filePath || 'none'}, errorCode=${result.errorCode || 'none'})`
      )
      return { isSupported: false, errorCode: result.errorCode }
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

  async fsRead(params: { filePath: string; offset?: number; limit?: number }) {
    return this.ipc.invoke('fs:read', params)
  }

  async fsReadImage(params: { filePath: string }): Promise<{ success: boolean; bytes?: ArrayBuffer; error?: string }> {
    return this.ipc.invoke('fs:read-image', params)
  }

  async readWorkspaceInstructions(directories: string[]): Promise<WorkspaceInstructionsResult> {
    return this.ipc.invoke('workspace:read-instructions', directories)
  }

  async fsList(params: { dirPath: string }) {
    return this.ipc.invoke('fs:list', params)
  }

  async fsSearch(params: { pattern: string; dirPath: string; regex?: boolean; include?: string }) {
    return this.ipc.invoke('fs:search', params)
  }

  async fsWrite(params: { filePath: string; content: string }) {
    return this.ipc.invoke('fs:write', params)
  }

  async fsEdit(params: {
    filePath: string
    search?: string
    replace?: string
    edits?: Array<{ search: string; replace: string }>
  }) {
    return this.ipc.invoke('fs:edit', params)
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

  public async installUpdate() {
    return this.ipc.invoke('install-update')
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

  public getSessionMetaStorage(): SessionMetaStorage {
    if (!this._sessionMetaStorage) {
      this._sessionMetaStorage = new IndexedDBSessionMetaStorage()
    }
    return this._sessionMetaStorage
  }

  public async sandboxExecCode(params: {
    code: string
    language: SandboxExecLanguage
    timeout?: number
    sessionId?: string
    toolCallId?: string
  }): Promise<SandboxExecResult> {
    return this.ipc.invoke('sandbox:exec-code', params)
  }

  public async sandboxRunCommand(params: {
    command: string
    shell: 'bash' | 'powershell'
    workdir?: string
    timeout?: number
    sessionId?: string
    toolCallId: string
  }): Promise<import('@shared/sandbox-provider').SandboxRunCommandResult> {
    return this.ipc.invoke('sandbox:run-command', params)
  }

  public async sandboxRead(params: {
    filePath: string
    offset?: number
    limit?: number
    sessionId?: string
  }): Promise<SandboxReadResult> {
    return this.ipc.invoke('sandbox:read', params)
  }

  public async sandboxWrite(params: { filePath: string; content: string; sessionId?: string }) {
    return this.ipc.invoke('sandbox:write', params)
  }

  public async sandboxEdit(params: {
    filePath: string
    search?: string
    replace?: string
    edits?: Array<{ search: string; replace: string }>
    sessionId?: string
  }) {
    return this.ipc.invoke('sandbox:edit', params)
  }

  public async sandboxLs(params: { dirPath: string; sessionId?: string }): Promise<SandboxOperationResult> {
    return this.ipc.invoke('sandbox:ls', params)
  }

  public async sandboxSearch(params: {
    pattern: string
    path: string
    regex?: boolean
    include?: string
    sessionId?: string
  }): Promise<SandboxOperationResult> {
    return this.ipc.invoke('sandbox:search', {
      ...params,
      dirPath: params.path,
    })
  }

  public async sandboxFind(params: {
    dirPath: string
    pattern?: string
    sessionId?: string
  }): Promise<SandboxOperationResult> {
    return this.ipc.invoke('sandbox:find', params)
  }

  public async sandboxKill(params?: { sessionId?: string; toolCallId?: string }) {
    return this.ipc.invoke('sandbox:kill', params)
  }

  public async sandboxReset(params?: { sessionId?: string }) {
    return this.ipc.invoke('sandbox:reset', params)
  }

  public async sandboxStatus(params?: { sessionId?: string }) {
    return this.ipc.invoke('sandbox:status', params)
  }

  public async sandboxResolveWorkingDir(params: { sessionId: string }) {
    return this.ipc.invoke('sandbox:resolve-working-dir', params)
  }

  public async sandboxCheckAvailability() {
    return this.ipc.invoke('sandbox:check-availability')
  }

  public async sandboxInitTemp(params: { sessionId: string; workingDirectories?: string[] }) {
    return this.ipc.invoke('sandbox:init-temp', params)
  }

  public async sandboxCopyFile(params: { content: string; targetFilename: string; sessionId?: string }) {
    return this.ipc.invoke('sandbox:copy-file', params)
  }

  public async sandboxCopyBlob(params: { blobKey: string; targetFilename: string; sessionId?: string }) {
    return this.ipc.invoke('sandbox:copy-blob', params)
  }

  public async sandboxSeedBlobs(params: {
    items: Array<{ blobKey: string; targetFilename: string }>
    sessionId?: string
  }) {
    return this.ipc.invoke('sandbox:seed-blobs', params)
  }

  public async sandboxExportFile(params: { sandboxPath: string; suggestedName?: string }) {
    return this.ipc.invoke('sandbox:export-file', params)
  }

  public async sandboxPersistArtifact(params: { sandboxPath: string; sessionId: string; displayName?: string }) {
    return this.ipc.invoke('sandbox:persist-artifact', params)
  }

  public async sandboxHasArtifacts(params: { sessionId: string }) {
    return this.ipc.invoke('sandbox:has-artifacts', params)
  }

  public async sandboxRemoveArtifacts(params: { sessionId: string }) {
    return this.ipc.invoke('sandbox:remove-artifacts', params)
  }

  public async sandboxReadFileBase64(params: {
    filePath: string
    maxBytes?: number
  }): Promise<{ success: boolean; base64?: string; error?: string }> {
    return this.ipc.invoke('sandbox:read-file-base64', params)
  }

  public async sandboxReadFileBytes(params: {
    filePath: string
    maxBytes?: number
  }): Promise<{ success: boolean; bytes?: ArrayBuffer; error?: string }> {
    return this.ipc.invoke('sandbox:read-file-bytes', params)
  }

  public async sandboxCreateHtmlPreview(params: { filePath: string }) {
    return this.ipc.invoke('sandbox:create-html-preview', params)
  }

  public async openDirectoryDialog() {
    return this.ipc.invoke('dialog:openDirectory')
  }

  public async scanLocalAgentMemories() {
    return this.ipc.invoke('agent-persona:scan-local-memories')
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
