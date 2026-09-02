/**
 * TestPlatform - 用于集成测试的平台实现
 *
 * 特点：
 * - 使用内存存储，不依赖真实文件系统或数据库
 * - 支持文件对话测试场景
 * - 可导出会话结果到文件
 */

import type { AnalyticsEventParams } from '@shared/analytics'
import * as defaults from '@shared/defaults'
import type { Config, Language, Settings, ShortcutSetting } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import { type ImageGenerationStorage, IndexedDBImageGenerationStorage } from '@/storage/ImageGenerationStorage'
import { IndexedDBSessionMetaStorage, type SessionMetaStorage } from '@/storage/SessionMetaStorage'
import type { Exporter, Platform, PlatformType, Storage } from './interfaces'
import type { KnowledgeBaseController } from './knowledge-base/interface'
import type { SessionAttachmentRagController } from './session-attachment-rag/interface'

/**
 * 内存存储类，用于测试环境
 */
export class InMemoryStorage implements Storage {
  private store = new Map<string, any>()

  public getStorageType(): string {
    return 'IN_MEMORY'
  }

  public async setStoreValue(key: string, value: any): Promise<void> {
    this.store.set(key, JSON.parse(JSON.stringify(value)))
  }

  public async getStoreValue(key: string): Promise<any> {
    const value = this.store.get(key)
    return value !== undefined ? value : null
  }

  public async delStoreValue(key: string): Promise<void> {
    this.store.delete(key)
  }

  public async getAllStoreValues(): Promise<{ [key: string]: any }> {
    const result: { [key: string]: any } = {}
    this.store.forEach((value, key) => {
      result[key] = value
    })
    return result
  }

  public async getAllStoreKeys(): Promise<string[]> {
    return Array.from(this.store.keys())
  }

  public async setAllStoreValues(data: { [key: string]: any }): Promise<void> {
    for (const [key, value] of Object.entries(data)) {
      await this.setStoreValue(key, value)
    }
  }

  public clear(): void {
    this.store.clear()
  }
}

/**
 * 测试用导出器
 */
class TestExporter implements Exporter {
  private exports: Map<string, any> = new Map()

  async exportBlob(filename: string, blob: Blob, encoding?: 'utf8' | 'ascii' | 'utf16'): Promise<void> {
    const text = await blob.text()
    this.exports.set(filename, text)
  }

  async exportTextFile(filename: string, content: string): Promise<void> {
    this.exports.set(filename, content)
  }

  async exportImageFile(basename: string, base64: string): Promise<void> {
    this.exports.set(basename, base64)
  }

  async exportByUrl(filename: string, url: string): Promise<void> {
    this.exports.set(filename, url)
  }

  async exportStreamingJson(
    filename: string,
    dataCallback: () => AsyncGenerator<string, void, unknown>
  ): Promise<void> {
    let content = ''
    for await (const chunk of dataCallback()) {
      content += chunk
    }
    this.exports.set(filename, content)
  }

  async exportStreamingFile(
    filename: string,
    dataCallback: () => AsyncGenerator<Uint8Array, void, unknown>,
    _mimeType: string,
    signal?: AbortSignal
  ): Promise<{ boundedMemory: boolean }> {
    const chunks: Uint8Array[] = []
    let total = 0
    for await (const chunk of dataCallback()) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Operation canceled', 'AbortError')
      chunks.push(chunk)
      total += chunk.length
    }
    const output = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      output.set(chunk, offset)
      offset += chunk.length
    }
    this.exports.set(filename, output)
    return { boundedMemory: true }
  }

  getExport(filename: string): any {
    return this.exports.get(filename)
  }

  getAllExports(): Map<string, any> {
    return new Map(this.exports)
  }

  clear(): void {
    this.exports.clear()
  }
}

/**
 * TestPlatform 实现
 */
export default class TestPlatform implements Platform {
  public type: PlatformType = 'web'
  public readonly isDesktopLike = false
  public exporter: TestExporter = new TestExporter()

  private storage = new InMemoryStorage()
  private _sessionMetaStorage: SessionMetaStorage | null = null
  private _imageGenerationStorage: ImageGenerationStorage | null = null
  private blobs = new Map<string, string>()
  private configs: Config | null = null
  private settings: Settings | null = null

  constructor() {
    // 初始化默认配置
    this.configs = defaults.newConfigs()
    this.settings = defaults.settings()
  }

  // ============ Storage 接口实现 ============

  public getStorageType(): string {
    return 'IN_MEMORY_TEST'
  }

  public async setStoreValue(key: string, value: any): Promise<void> {
    return this.storage.setStoreValue(key, value)
  }

  public async getStoreValue(key: string): Promise<any> {
    return this.storage.getStoreValue(key)
  }

  public async delStoreValue(key: string): Promise<void> {
    return this.storage.delStoreValue(key)
  }

  public async getAllStoreValues(): Promise<{ [key: string]: any }> {
    return this.storage.getAllStoreValues()
  }

  public async getAllStoreKeys(): Promise<string[]> {
    return this.storage.getAllStoreKeys()
  }

  public async setAllStoreValues(data: { [key: string]: any }): Promise<void> {
    return this.storage.setAllStoreValues(data)
  }

  // ============ Blob 存储实现 ============

  public async getStoreBlob(key: string): Promise<string | null> {
    return this.blobs.get(key) ?? null
  }

  public async setStoreBlob(key: string, value: string): Promise<void> {
    this.blobs.set(key, value)
  }

  public async delStoreBlob(key: string): Promise<void> {
    this.blobs.delete(key)
  }

  public async listStoreBlobKeys(): Promise<string[]> {
    return Array.from(this.blobs.keys())
  }

  // ============ 系统相关 ============

  public async getVersion(): Promise<string> {
    return 'test'
  }

  public async getPlatform(): Promise<string> {
    return 'test'
  }

  public async getArch(): Promise<string> {
    return 'test'
  }

  public async shouldUseDarkColors(): Promise<boolean> {
    return false
  }

  public onSystemThemeChange(callback: () => void): () => void {
    return () => {}
  }

  public onWindowShow(callback: () => void): () => void {
    return () => {}
  }

  public onWindowFocused(callback: () => void): () => void {
    return () => {}
  }

  public async isWindowFocused(): Promise<boolean> {
    return true
  }

  public onUpdateDownloaded(callback: () => void): () => void {
    return () => {}
  }

  public async openLink(url: string): Promise<void> {
    // no-op in test
  }

  public async getDeviceName(): Promise<string> {
    return 'test-device'
  }

  public async getInstanceName(): Promise<string> {
    return 'test-instance'
  }

  public async getLocale(): Promise<Language> {
    return 'en'
  }

  public async ensureShortcutConfig(config: ShortcutSetting): Promise<void> {
    // no-op in test
  }

  public async ensureProxyConfig(config: { proxy?: string }): Promise<void> {
    // no-op in test
  }

  public async relaunch(): Promise<void> {
    // no-op in test
  }

  // ============ 数据配置 ============

  public async getConfig(): Promise<Config> {
    if (!this.configs) {
      this.configs = defaults.newConfigs()
    }
    return this.configs
  }

  public async getSettings(): Promise<Settings> {
    if (!this.settings) {
      this.settings = defaults.settings()
    }
    return this.settings
  }

  // ============ 追踪 ============

  public initTracking(): void {
    // no-op in test
  }

  public trackingEvent(name: string, params: AnalyticsEventParams): void {
    // no-op in test
  }

  // ============ 通知 ============

  public async shouldShowAboutDialogWhenStartUp(): Promise<boolean> {
    return false
  }

  public async appLog(level: string, message: string): Promise<void> {
    console.log(`[${level}] ${message}`)
  }

  public async exportLogs(): Promise<string> {
    return ''
  }

  public async clearLogs(): Promise<void> {
    // no-op
  }

  public async ensureAutoLaunch(enable: boolean): Promise<void> {
    // no-op
  }

  public async parseFileLocally(file: File): Promise<{ key?: string; isSupported: boolean }> {
    // 简单实现：读取文件内容
    try {
      const text = await file.text()
      const key = `parseFile-${uuidv4()}`
      await this.setStoreBlob(key, text)
      return { key, isSupported: true }
    } catch {
      return { isSupported: false }
    }
  }

  public getLocalFilePath(file: File): string {
    return file.path || ''
  }

  public async isFullscreen(): Promise<boolean> {
    return false
  }

  public async setFullscreen(enabled: boolean): Promise<void> {
    // no-op
  }

  public async installUpdate(): Promise<void> {
    throw new Error('Method not implemented in test platform.')
  }

  public getKnowledgeBaseController(): KnowledgeBaseController {
    throw new Error('Knowledge base not implemented in test platform.')
  }

  public getSessionAttachmentRagController(): SessionAttachmentRagController {
    throw new Error('Session attachment RAG not implemented in test platform.')
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

  public async minimize(): Promise<void> {
    // no-op
  }

  public async maximize(): Promise<void> {
    // no-op
  }

  public async unmaximize(): Promise<void> {
    // no-op
  }

  public async closeWindow(): Promise<void> {
    // no-op
  }

  public async isMaximized(): Promise<boolean> {
    return false
  }

  public onMaximizedChange(callback: (isMaximized: boolean) => void): () => void {
    return () => {}
  }

  // ============ 测试辅助方法 ============

  /**
   * 加载文件内容到 blob 存储
   * @param storageKey 存储键名
   * @param content 文件内容
   */
  public loadFile(storageKey: string, content: string): void {
    this.blobs.set(storageKey, content)
  }

  /**
   * 批量加载文件
   * @param files 文件映射 { storageKey: content }
   */
  public loadFiles(files: Record<string, string>): void {
    for (const [key, content] of Object.entries(files)) {
      this.blobs.set(key, content)
    }
  }

  /**
   * 获取所有 blob 存储的内容
   */
  public getAllBlobs(): Record<string, string> {
    const result: Record<string, string> = {}
    this.blobs.forEach((value, key) => {
      result[key] = value
    })
    return result
  }

  /**
   * 清空所有存储
   */
  public clear(): void {
    this.storage.clear()
    this.blobs.clear()
    this.exporter.clear()
    this.configs = null
    this.settings = null
    this._sessionMetaStorage = null
    this._imageGenerationStorage = null
  }

  /**
   * 设置测试用的 settings
   */
  public setSettings(settings: Partial<Settings>): void {
    this.settings = { ...defaults.settings(), ...settings }
  }

  /**
   * 设置测试用的 config
   */
  public setConfig(config: Partial<Config>): void {
    this.configs = { ...defaults.newConfigs(), ...config }
  }

  /**
   * 获取内部存储实例
   */
  public getInternalStorage(): InMemoryStorage {
    return this.storage
  }
}
