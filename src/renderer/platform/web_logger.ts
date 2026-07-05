import dayjs from 'dayjs'
import localforage from 'localforage'

const LOG_STORAGE_KEY = 'workspaice-app-logs'
const MAX_LOG_ENTRIES = 1000 // 最大日志条数
const MAX_LOG_AGE_DAYS = 30 // 日志保留天数

interface LogEntry {
  timestamp: string
  level: string
  message: string
}

/**
 * Web 平台日志管理器
 * 使用 localforage (IndexedDB) 存储日志
 */
export class WebLogger {
  private static instance: WebLogger
  private logBuffer: LogEntry[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private isInitialized = false

  private constructor() {}

  public static getInstance(): WebLogger {
    if (!WebLogger.instance) {
      WebLogger.instance = new WebLogger()
    }
    return WebLogger.instance
  }

  /**
   * 初始化日志系统
   */
  public async init(): Promise<void> {
    if (this.isInitialized) return

    try {
      // 清理过期日志
      await this.cleanupOldLogs()
      this.isInitialized = true
    } catch (error) {
      console.error('Failed to initialize web logger:', error)
    }
  }

  /**
   * 清理过期日志
   */
  private async cleanupOldLogs(): Promise<void> {
    try {
      const logs = await this.getStoredLogs()
      if (logs.length === 0) return

      const cutoffDate = dayjs().subtract(MAX_LOG_AGE_DAYS, 'day')
      const filteredLogs = logs.filter((log) => {
        const logDate = dayjs(log.timestamp)
        return logDate.isAfter(cutoffDate)
      })

      // 只保留最新的 MAX_LOG_ENTRIES 条
      const trimmedLogs = filteredLogs.slice(-MAX_LOG_ENTRIES)

      if (trimmedLogs.length !== logs.length) {
        await localforage.setItem(LOG_STORAGE_KEY, trimmedLogs)
      }
    } catch (error) {
      console.error('Failed to cleanup old logs:', error)
    }
  }

  /**
   * 获取存储的日志
   */
  private async getStoredLogs(): Promise<LogEntry[]> {
    try {
      const logs = await localforage.getItem<LogEntry[]>(LOG_STORAGE_KEY)
      return logs || []
    } catch (error) {
      return []
    }
  }

  /**
   * 记录日志
   */
  public log(level: string, message: string): void {
    const timestamp = dayjs().format('YYYY-MM-DD HH:mm:ss.SSS')

    // 同时输出到控制台
    console.log(`APP_LOG: [${level}] ${message}`)

    // 添加到缓冲区
    this.logBuffer.push({ timestamp, level: level.toUpperCase(), message })

    // 使用延迟批量写入以提高性能
    this.scheduleFlush()
  }

  /**
   * 调度批量写入
   */
  private scheduleFlush(): void {
    if (this.flushTimer) return

    // 延迟 1000ms 批量写入
    this.flushTimer = setTimeout(() => {
      void this.flush()
    }, 1000)
  }

  /**
   * 将缓冲区内容写入存储
   */
  private async flush(): Promise<void> {
    this.flushTimer = null

    if (this.logBuffer.length === 0) return

    const newLogs = [...this.logBuffer]
    this.logBuffer = []

    try {
      const existingLogs = await this.getStoredLogs()
      const allLogs = [...existingLogs, ...newLogs]

      // 限制日志数量
      const trimmedLogs = allLogs.slice(-MAX_LOG_ENTRIES)

      await localforage.setItem(LOG_STORAGE_KEY, trimmedLogs)
    } catch (error) {
      console.error('Failed to save logs:', error)
    }
  }

  /**
   * 立即刷新缓冲区
   */
  public async flushNow(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    await this.flush()
  }

  /**
   * 导出日志内容
   * @returns 格式化的日志内容
   */
  public async exportLogs(): Promise<string> {
    // 确保所有缓冲内容已写入
    await this.flushNow()

    try {
      const logs = await this.getStoredLogs()
      return logs.map((log) => `[${log.timestamp}] [${log.level}] ${log.message}`).join('\n')
    } catch (error) {
      console.error('Failed to export logs:', error)
      return ''
    }
  }

  /**
   * 清空日志
   */
  public async clearLogs(): Promise<void> {
    this.logBuffer = []
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    try {
      await localforage.removeItem(LOG_STORAGE_KEY)
    } catch (error) {
      console.error('Failed to clear logs:', error)
    }
  }
}

export default WebLogger.getInstance()
