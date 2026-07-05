import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Device } from '@capacitor/device'
import * as defaults from '@shared/defaults'
import type { Config, Settings, ShortcutSetting } from '@shared/types'
import localforage from 'localforage'
import { v4 as uuidv4 } from 'uuid'
import { parseLocale } from '@/i18n/parser'
import type { ImageGenerationStorage } from '@/storage/ImageGenerationStorage'
import type { SessionMetaStorage } from '@/storage/SessionMetaStorage'
import { SQLiteImageGenerationStorage } from '@/storage/SQLiteImageGenerationStorage'
import { SQLiteSessionMetaStorage } from '@/storage/SQLiteSessionMetaStorage'
import { IndexedDBTaskSessionStorage, type TaskSessionStorage } from '@/storage/TaskSessionStorage'
import type { FileWithLegacyPath } from '@/utils/file-native-path'
import { WORKSPAICE_BUILD_PLATFORM } from '@/variables'
import { getBrowser, getOS } from '../packages/navigator'
import type { Platform, PlatformType } from './interfaces'
import type { KnowledgeBaseController } from './knowledge-base/interface'
import MobileExporter from './mobile_exporter'
import mobileLogger from './mobile_logger'
import type { SessionAttachmentRagController } from './session-attachment-rag/interface'
import { MobileSQLiteStorage } from './storages'
import { parseTextFileLocally } from './web_platform_utils'

export default class MobilePlatform extends MobileSQLiteStorage implements Platform {
  public type: PlatformType = 'mobile'

  public exporter = new MobileExporter()

  private navigationCallback: ((path: string) => void) | null = null
  private _imageGenerationStorage: ImageGenerationStorage | null = null
  private _taskSessionStorage: TaskSessionStorage | null = null
  private _sessionMetaStorage: SessionMetaStorage | null = null

  constructor() {
    super()
    mobileLogger.init().catch((e) => console.error('Failed to init mobile logger:', e))
    // 监听深度链接 (Deep Links)
    void App.addListener('appUrlOpen', (event) => {
      console.debug('App URL opened:', event.url)
      this.handleDeepLink(event.url)
    })
  }

  // 处理深度链接
  private handleDeepLink(url: string): void {
    try {
      // 支持 workspaice:// 和 workspaice-dev:// 两种协议（归一化处理）
      const normalizedUrl = url.replace(/^workspaice-dev:\/\//, 'workspaice://')
      const parsedUrl = new URL(normalizedUrl)

      // 处理 provider 导入链接: workspaice://provider/import?config=<base64-encoded-config>
      if (parsedUrl.hostname === 'provider' && parsedUrl.pathname === '/import') {
        const encodedConfig = parsedUrl.searchParams.get('config') || ''
        const path = `/settings/provider?import=${encodeURIComponent(encodedConfig)}`
        this.triggerNavigation(path)
        return
      }

      // 处理 auth 回调链接: workspaice://auth/callback?ticket_id=xxx&status=success
      if (parsedUrl.hostname === 'auth' && parsedUrl.pathname === '/callback') {
        // 不需要，实际跳回到 app 后业务hooks useLogin 会处理后续动作
      }

      console.warn('Unhandled deep link:', url)
    } catch (error) {
      console.error('Failed to handle deep link:', error)
    }
  }

  // 触发导航
  private triggerNavigation(path: string): void {
    if (this.navigationCallback) {
      this.navigationCallback(path)
    } else {
      console.warn('Navigation callback not set, path:', path)
    }
  }

  // 设置导航回调（类似 electronAPI.onNavigate）
  public onNavigate(callback: (path: string) => void): () => void {
    this.navigationCallback = callback
    return () => {
      this.navigationCallback = null
    }
  }

  public async getVersion(): Promise<string> {
    return (await App.getInfo()).version
  }
  public async getPlatform(): Promise<string> {
    return WORKSPAICE_BUILD_PLATFORM
  }
  public async getArch(): Promise<string> {
    return 'arm64'
  }
  public async shouldUseDarkColors(): Promise<boolean> {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  public onSystemThemeChange(callback: () => void): () => void {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', callback)
    return () => {
      window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', callback)
    }
  }
  public onWindowShow(callback: () => void): () => void {
    return () => null
  }
  public onWindowFocused(callback: () => void): () => void {
    return () => null
  }
  public async openLink(url: string): Promise<void> {
    try {
      // 使用 Browser.open 打开
      // 原生插件不受 JavaScript 用户手势限制，可以在异步调用后正常工作
      // iOS: 会使用 SFSafariViewController 而不是普通 webview
      // Android: 使用 Chrome Custom Tabs
      await Browser.open({
        url,
      })
    } catch (error) {
      console.error('Failed to open link with Browser plugin:', error)
      // 降级方案：使用 window.open（但在异步调用后可能被阻止）
      window.open(url)
    }
  }
  public async getDeviceName(): Promise<string> {
    try {
      const info = await Device.getInfo()

      // iOS: 直接返回 model 型号（如 "iPhone13,4"），官网会 mapping 成 "iPhone 13 Pro Max"
      if (info.platform === 'ios') {
        return info.model
      }

      // Android: 使用降级策略
      // 优先使用 name（用户自定义的设备名称）
      if (info.name) {
        return info.name
      }
      // 如果没有 name，返回 manufacturer + model
      if (info.manufacturer && info.model) {
        return `${info.manufacturer} ${info.model}`
      }
      // 降级到 model 或 platform
      return info.model || info.platform || getOS()
    } catch (error) {
      console.error('Failed to get device info:', error)
      // 降级方案：返回 OS 信息
      return getOS()
    }
  }
  public async getInstanceName(): Promise<string> {
    return `${getOS()} / ${getBrowser()}`
  }
  public async getLocale() {
    const lang = window.navigator.language
    return parseLocale(lang)
  }
  public async ensureShortcutConfig(config: ShortcutSetting): Promise<void> {
    return
  }
  public async ensureProxyConfig(config: { proxy?: string }): Promise<void> {
    return
  }
  public async relaunch(): Promise<void> {
    location.reload()
  }

  public async getConfig(): Promise<Config> {
    let value = await this.getStoreValue('configs')
    if (value === undefined || value === null) {
      value = defaults.newConfigs()
      void this.setStoreValue('configs', value)
    }
    return value
  }
  public async getSettings(): Promise<Settings> {
    let value = await this.getStoreValue('settings')
    if (value === undefined || value === null) {
      value = defaults.settings()
      void this.setStoreValue('settings', value)
    }
    return value
  }

  public async getStoreBlob(key: string): Promise<string | null> {
    return localforage.getItem<string>(key)
  }
  public async setStoreBlob(key: string, value: string): Promise<void> {
    await localforage.setItem(key, value)
  }
  public async delStoreBlob(key: string) {
    return localforage.removeItem(key)
  }
  public async listStoreBlobKeys(): Promise<string[]> {
    return localforage.keys()
  }

  public async shouldShowAboutDialogWhenStartUp(): Promise<boolean> {
    return false
  }

  public async appLog(level: string, message: string): Promise<void> {
    mobileLogger.log(level, message)
  }

  public async exportLogs(): Promise<string> {
    return mobileLogger.exportLogs()
  }

  public async clearLogs(): Promise<void> {
    return mobileLogger.clearLogs()
  }

  public async ensureAutoLaunch(enable: boolean) {
    return
  }

  async parseFileLocally(file: File): Promise<{ key?: string; isSupported: boolean }> {
    const result = await parseTextFileLocally(file)
    if (!result.isSupported) {
      return { isSupported: false }
    }
    const key = `parseFile-${uuidv4()}`
    await this.setStoreBlob(key, result.text)
    return { key, isSupported: true }
  }

  getLocalFilePath(file: File): string {
    return (file as FileWithLegacyPath).path || ''
  }

  public async parseUrl(url: string): Promise<{ key: string; title: string }> {
    throw new Error('Not implemented')
  }

  public async isFullscreen() {
    return true
  }

  public async setFullscreen(enabled: boolean): Promise<void> {
    return
  }

  public getKnowledgeBaseController(): KnowledgeBaseController {
    throw new Error('Method not implemented.')
  }

  public getSessionAttachmentRagController(): SessionAttachmentRagController {
    throw new Error('Session attachment RAG is not implemented on mobile.')
  }

  public getImageGenerationStorage(): ImageGenerationStorage {
    if (!this._imageGenerationStorage) {
      this._imageGenerationStorage = new SQLiteImageGenerationStorage()
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
      this._sessionMetaStorage = new SQLiteSessionMetaStorage()
    }
    return this._sessionMetaStorage
  }

  public minimize() {
    return Promise.resolve()
  }

  public maximize() {
    return Promise.resolve()
  }

  public unmaximize() {
    return Promise.resolve()
  }

  public closeWindow() {
    return Promise.resolve()
  }

  public isMaximized() {
    return Promise.resolve(true)
  }

  public onMaximizedChange() {
    return () => null
  }
}
