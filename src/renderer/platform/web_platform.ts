import localforage from 'localforage'
import * as defaults from 'src/shared/defaults'
import type { Config, Settings, ShortcutSetting } from 'src/shared/types'
import { v4 as uuidv4 } from 'uuid'
import { parseLocale } from '@/i18n/parser'
import { getBrowser, getOS } from '../packages/navigator'
import type { Platform, PlatformType } from './interfaces'
import type { KnowledgeBaseController } from './knowledge-base/interface'
import { IndexedDBStorage } from './storages'
import WebExporter from './web_exporter'
import { parseTextFileLocally } from './web_platform_utils'

export default class WebPlatform extends IndexedDBStorage implements Platform {
  public type: PlatformType = 'web'

  public exporter = new WebExporter()

  public async getVersion(): Promise<string> {
    return 'web'
  }
  public async getPlatform(): Promise<string> {
    return 'web'
  }
  public async getArch(): Promise<string> {
    return 'web'
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
  public onUpdateDownloaded(callback: () => void): () => void {
    return () => null
  }
  public async openLink(url: string): Promise<void> {
    window.open(url)
  }
  public async getDeviceName(): Promise<string> {
    // Web 平台返回浏览器名称
    return getBrowser()
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
    let value: Config = await this.getStoreValue('configs')
    if (value === undefined || value === null) {
      value = defaults.newConfigs()
      await this.setStoreValue('configs', value)
    }
    return value
  }
  public async getSettings(): Promise<Settings> {
    let value: Settings = await this.getStoreValue('settings')
    if (value === undefined || value === null) {
      value = defaults.settings()
      await this.setStoreValue('settings', value)
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
    const GAID = 'G-B365F44W6E'
    try {
      const conf = await this.getConfig()
      window.gtag('config', GAID, {
        app_name: 'chatbox',
        user_id: conf.uuid,
        client_id: conf.uuid,
        app_version: await this.getVersion(),
        chatbox_platform_type: 'web',
        chatbox_platform: await this.getPlatform(),
        app_platform: await this.getPlatform(),
      })
    } catch (e) {
      window.gtag('config', GAID, {
        app_name: 'chatbox',
      })
      throw e
    }
  }
  public trackingEvent(name: string, params: { [key: string]: string }) {
    window.gtag('event', name, params)
  }

  public async shouldShowAboutDialogWhenStartUp(): Promise<boolean> {
    return false
  }

  public async appLog(level: string, message: string): Promise<void> {
    console.log(`APP_LOG: [${level}] ${message}`)
  }

  public async ensureAutoLaunch(enable: boolean) {
    return
  }

  async parseFileLocally(file: File): Promise<{ key?: string; isSupported: boolean }> {
    const result = await parseTextFileLocally(file)
    if (!result.isSupported) {
      return { isSupported: false }
    }
    const key = `parseFile-` + uuidv4()
    await this.setStoreBlob(key, result.text)
    return { key, isSupported: true }
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
