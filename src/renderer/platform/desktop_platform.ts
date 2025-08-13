import type { ElectronIPC } from 'src/shared/electron-types'
import type { Config, Settings, ShortcutSetting } from 'src/shared/types'
import { v4 as uuidv4 } from 'uuid'
import { parseLocale } from '@/i18n/parser'
import { sliceTextByTokenLimit } from '@/packages/token'
import { cache } from 'src/shared/utils/cache'
import { getOS } from '../packages/navigator'
import type { Platform, PlatformType } from './interfaces'
import DesktopKnowledgeBaseController from './knowledge-base/desktop-controller'
import WebExporter from './web_exporter'
import { parseTextFileLocally } from './web_platform_utils'

export default class DesktopPlatform implements Platform {
  public type: PlatformType = 'desktop'

  public exporter = new WebExporter()

  private _kbController?: DesktopKnowledgeBaseController

  public ipc: ElectronIPC
  constructor(ipc: ElectronIPC) {
    this.ipc = ipc
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
  public onUpdateDownloaded(callback: () => void): () => void {
    return this.ipc.onUpdateDownloaded(callback)
  }
  public onNavigate(callback: (path: string) => void): () => void {
    return window.electronAPI.onNavigate(callback)
  }
  public async openLink(url: string): Promise<void> {
    return this.ipc.invoke('openLink', url)
  }
  public async getInstanceName(): Promise<string> {
    const hostname = await cache('ipc:getHostname', () => this.ipc.invoke('getHostname'), { ttl: 5 * 60 * 1000 })
    return `${hostname} / ${getOS()}`
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

  public async setStoreValue(key: string, value: any) {
    // 为什么要序列化？
    // 为了实现进程通信，electron invoke 会自动对传输数据进行序列化，
    // 但如果数据包含无法被序列化的类型（比如 message 中常带有的 cancel 函数）将直接报错：
    // Uncaught (in promise) Error: An object could not be cloned.
    // 因此对于数据类型不容易控制的场景，应该提前 JSON.stringify，这种序列化方式会自动处理异常类型。
    const valueJson = JSON.stringify(value)
    return this.ipc.invoke('setStoreValue', key, valueJson)
  }
  public async getStoreValue(key: string) {
    return this.ipc.invoke('getStoreValue', key)
  }
  public delStoreValue(key: string) {
    return this.ipc.invoke('delStoreValue', key)
  }
  public async getAllStoreValues(): Promise<{ [key: string]: any }> {
    const json = await this.ipc.invoke('getAllStoreValues')
    return JSON.parse(json)
  }
  public async setAllStoreValues(data: { [key: string]: any }) {
    await this.ipc.invoke('setAllStoreValues', JSON.stringify(data))
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
    setTimeout(() => {
      this.trackingEvent('user_engagement', {})
    }, 4000) // 怀疑应用初始化后需要一段时间才能正常工作
  }
  public trackingEvent(name: string, params: { [key: string]: string }) {
    const dataJson = JSON.stringify({ name, params })
    this.ipc.invoke('analysticTrackingEvent', dataJson)
  }

  public async shouldShowAboutDialogWhenStartUp(): Promise<boolean> {
    return cache('ipc:shouldShowAboutDialogWhenStartUp', () => this.ipc.invoke('shouldShowAboutDialogWhenStartUp'), {
      ttl: 30 * 1000,
    })
  }

  public async appLog(level: string, message: string) {
    return this.ipc.invoke('appLog', JSON.stringify({ level, message }))
  }

  public async ensureAutoLaunch(enable: boolean) {
    return this.ipc.invoke('ensureAutoLaunch', enable)
  }

  async parseFileLocally(
    file: File,
    options?: { tokenLimit?: number }
  ): Promise<{ key?: string; isSupported: boolean }> {
    let result: { text: string; isSupported: boolean }
    if (!file.path) {
      // 复制长文本粘贴的文件是没有 path 的
      result = await parseTextFileLocally(file)
    } else {
      const resultJSON = await this.ipc.invoke('parseFileLocally', JSON.stringify({ filePath: file.path }))
      result = JSON.parse(resultJSON)
    }
    if (!result.isSupported) {
      return { isSupported: false }
    }
    if (options?.tokenLimit) {
      result.text = sliceTextByTokenLimit(result.text, options.tokenLimit)
    }
    const key = `parseFile-` + uuidv4()
    await this.setStoreBlob(key, result.text)
    return { key, isSupported: true }
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
}
