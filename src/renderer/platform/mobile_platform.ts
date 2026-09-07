import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Device } from '@capacitor/device'
import { type AnalyticsEventParams, GOOGLE_ANALYTICS_MEASUREMENT_ID } from '@shared/analytics'
import * as defaults from '@shared/defaults'
import type { Config, Settings, ShortcutSetting } from '@shared/types'
import localforage from 'localforage'
import { v4 as uuidv4 } from 'uuid'
import { parseLocale } from '@/i18n/parser'
import type { ImageGenerationStorage } from '@/storage/ImageGenerationStorage'
import type { SessionMetaStorage } from '@/storage/SessionMetaStorage'
import { SQLiteImageGenerationStorage } from '@/storage/SQLiteImageGenerationStorage'
import { SQLiteSessionMetaStorage } from '@/storage/SQLiteSessionMetaStorage'
import { CHATBOX_BUILD_PLATFORM } from '@/variables'
import { getBrowser, getOS } from '../packages/navigator'
import type { Platform, PlatformType } from './interfaces'
import type { KnowledgeBaseController } from './knowledge-base/interface'
import MobileExporter from './mobile_exporter'
import mobileLogger from './mobile_logger'
import type { SessionAttachmentRagController } from './session-attachment-rag/interface'
import { MobileSQLiteStorage } from './storages'
import { parseFileLocallyInBrowser } from './web_platform_utils'

export default class MobilePlatform extends MobileSQLiteStorage implements Platform {
  public type: PlatformType = 'mobile'
  public readonly isDesktopLike = false

  public exporter = new MobileExporter()

  private navigationCallback: ((path: string) => void) | null = null
  private _imageGenerationStorage: ImageGenerationStorage | null = null
  private _sessionMetaStorage: SessionMetaStorage | null = null

  constructor() {
    super()
    mobileLogger.init().catch((e) => console.error('Failed to init mobile logger:', e))
    // 监听深度链接 (Deep Links)
    App.addListener('appUrlOpen', (event) => {
      console.debug('App URL opened:', event.url)
      this.handleDeepLink(event.url)
    })
  }

  // 处理深度链接
  private handleDeepLink(url: string): void {
    try {
      // 支持 chatbox:// 和 chatbox-dev:// 两种协议（归一化处理）
      const normalizedUrl = url.replace(/^chatbox-dev:\/\//, 'chatbox://')
      const parsedUrl = new URL(normalizedUrl)

      // 处理 provider 导入链接: chatbox://provider/import?config=<base64-encoded-config>
      if (parsedUrl.hostname === 'provider' && parsedUrl.pathname === '/import') {
        const encodedConfig = parsedUrl.searchParams.get('config') || ''
        const path = `/settings/provider?import=${encodeURIComponent(encodedConfig)}`
        this.triggerNavigation(path)
        return
      }

      // 处理 auth 回调链接: chatbox://auth/callback?ticket_id=xxx&status=success
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
    return CHATBOX_BUILD_PLATFORM
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
    let cancelled = false
    let removeAppStateListener: (() => void) | undefined

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        callback()
      }
    }

    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive && !cancelled) {
        callback()
      }
    })
      .then((handle) => {
        if (cancelled) {
          void handle.remove()
          return
        }
        removeAppStateListener = () => {
          void handle.remove()
        }
      })
      .catch((error) => {
        console.warn('Failed to listen appStateChange:', error)
      })

    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      removeAppStateListener?.()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }
  public async isWindowFocused(): Promise<boolean> {
    try {
      const state = await App.getState()
      return state.isActive && document.visibilityState === 'visible'
    } catch {
      return document.visibilityState === 'visible'
    }
  }
  public onUpdateDownloaded(callback: () => void): () => void {
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
      this.setStoreValue('configs', value)
    }
    return value
  }
  public async getSettings(): Promise<Settings> {
    let value = await this.getStoreValue('settings')
    if (value === undefined || value === null) {
      value = defaults.settings()
      this.setStoreValue('settings', value)
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

  public async initTracking() {
    const conf = await this.getConfig()
    window.gtag('config', GOOGLE_ANALYTICS_MEASUREMENT_ID, {
      app_name: 'chatbox',
      user_id: conf.uuid,
      client_id: conf.uuid,
      app_version: await this.getVersion(),
      chatbox_platform_type: 'mobile',
      chatbox_platform: await this.getPlatform(),
      app_platform: await this.getPlatform(),
    })
  }
  public trackingEvent(name: string, params: AnalyticsEventParams) {
    window.gtag('event', name, params)
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

  async parseFileLocally(file: File): Promise<{ key?: string; isSupported: boolean; errorCode?: string }> {
    const result = await parseFileLocallyInBrowser(file)
    if (!result.isSupported) {
      return { isSupported: false, errorCode: result.errorCode }
    }
    const key = `parseFile-${uuidv4()}`
    await this.setStoreBlob(key, result.text)
    return { key, isSupported: true }
  }

  getLocalFilePath(file: File): string {
    return file.path || ''
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

  installUpdate(): Promise<void> {
    throw new Error('Method not implemented.')
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
