/** biome-ignore-all lint/suspicious/noExplicitAny: <any> */
import localforage from 'localforage'
import type { ElectronIPC } from 'src/shared/electron-types'
import type { Config, Settings, ShortcutSetting } from 'src/shared/types'
import { cache } from 'src/shared/utils/cache'
import { v4 as uuidv4 } from 'uuid'
import { parseLocale } from '@/i18n/parser'
import { getOS } from '../packages/navigator'
import type { Platform, PlatformType } from './interfaces'
import DesktopKnowledgeBaseController from './knowledge-base/desktop-controller'
import WebExporter from './web_exporter'
import { parseTextFileLocally } from './web_platform_utils'

const store = localforage.createInstance({ name: 'chatboxstore' })

export default class DesktopPlatform implements Platform {
  public type: PlatformType = 'desktop'

  public exporter = new WebExporter()

  private _kbController?: DesktopKnowledgeBaseController

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
  public onUpdateDownloaded(callback: () => void): () => void {
    return this.ipc.onUpdateDownloaded(callback)
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
    } catch (error: any) {
      throw new Error(`Failed to serialize value for key "${key}": ${error.message}`)
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

  async parseFileLocally(file: File): Promise<{ key?: string; isSupported: boolean }> {
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
