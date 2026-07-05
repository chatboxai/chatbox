import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import dayjs from 'dayjs'

const LOG_FILE_NAME = 'workspaice-app.log'
const LOG_DIRECTORY = Directory.Data
const MAX_LOG_SIZE = 5 * 1024 * 1024 // 5MB，超过此大小会轮转
const MAX_LOG_AGE_DAYS = 30 // 日志保留天数

/**
 * Mobile 平台日志管理器
 * 使用 Capacitor Filesystem 将日志追加到文件
 */
export class MobileLogger {
  private static instance: MobileLogger
  private logBuffer: string[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private isInitialized = false

  private constructor() {}

  public static getInstance(): MobileLogger {
    if (!MobileLogger.instance) {
      MobileLogger.instance = new MobileLogger()
    }
    return MobileLogger.instance
  }

  /**
   * 初始化日志系统
   * 检查日志文件大小，必要时进行轮转
   */
  public async init(): Promise<void> {
    if (this.isInitialized) return

    try {
      // 检查日志文件是否存在以及大小
      await this.checkAndRotateLog()
      this.isInitialized = true
    } catch (error) {
      console.error('Failed to initialize mobile logger:', error)
    }
  }

  /**
   * 检查日志文件大小，必要时进行轮转
   */
  private async checkAndRotateLog(): Promise<void> {
    try {
      const stat = await Filesystem.stat({
        path: LOG_FILE_NAME,
        directory: LOG_DIRECTORY,
      })

      // 如果日志文件超过最大大小，进行轮转
      if (stat.size > MAX_LOG_SIZE) {
        await this.rotateLog()
      }

      // 检查日志文件创建时间，如果超过保留天数，清空
      if (stat.ctime) {
        const logAge = dayjs().diff(dayjs(stat.ctime), 'day')
        if (logAge > MAX_LOG_AGE_DAYS) {
          await this.clearLogs()
        }
      }
    } catch (error) {
      // 文件不存在是正常的，会在第一次写入时创建
    }
  }

  /**
   * 轮转日志文件
   * 将当前日志重命名为带时间戳的备份，并创建新日志文件
   */
  private async rotateLog(): Promise<void> {
    try {
      const timestamp = dayjs().format('YYYY-MM-DD_HH-mm-ss')
      const backupName = `workspaice-app-${timestamp}.log`

      // 重命名当前日志文件
      await Filesystem.rename({
        from: LOG_FILE_NAME,
        to: backupName,
        directory: LOG_DIRECTORY,
      })

      // 清理旧的备份文件
      await this.cleanupOldBackups()
    } catch (error) {
      console.error('Failed to rotate log:', error)
    }
  }

  /**
   * 清理旧的备份日志文件
   */
  private async cleanupOldBackups(): Promise<void> {
    try {
      const result = await Filesystem.readdir({
        path: '',
        directory: LOG_DIRECTORY,
      })

      const logBackups = result.files
        .filter((file) => file.name.startsWith('workspaice-app-') && file.name.endsWith('.log'))
        .sort((a, b) => (b.mtime || 0) - (a.mtime || 0))

      // 只保留最新的 3 个备份
      const toDelete = logBackups.slice(3)
      for (const file of toDelete) {
        await Filesystem.deleteFile({
          path: file.name,
          directory: LOG_DIRECTORY,
        })
      }
    } catch (error) {
      console.error('Failed to cleanup old backups:', error)
    }
  }

  /**
   * 记录日志
   * @param level 日志级别
   * @param message 日志消息
   */
  public log(level: string, message: string): void {
    const timestamp = dayjs().format('YYYY-MM-DD HH:mm:ss.SSS')
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`

    // 同时输出到控制台
    console.log(`APP_LOG: [${level}] ${message}`)

    // 添加到缓冲区
    this.logBuffer.push(logEntry)

    // 使用延迟批量写入以提高性能
    this.scheduleFlush()
  }

  /**
   * 调度批量写入
   */
  private scheduleFlush(): void {
    if (this.flushTimer) return

    // 延迟 500ms 批量写入
    this.flushTimer = setTimeout(() => {
      void this.flush()
    }, 500)
  }

  /**
   * 将缓冲区内容写入文件
   */
  private async flush(): Promise<void> {
    this.flushTimer = null

    if (this.logBuffer.length === 0) return

    const content = this.logBuffer.join('')
    this.logBuffer = []

    try {
      await Filesystem.appendFile({
        path: LOG_FILE_NAME,
        data: content,
        directory: LOG_DIRECTORY,
        encoding: Encoding.UTF8,
      })
    } catch (error) {
      // 如果追加失败（可能文件不存在），尝试创建新文件
      try {
        await Filesystem.writeFile({
          path: LOG_FILE_NAME,
          data: content,
          directory: LOG_DIRECTORY,
          encoding: Encoding.UTF8,
          recursive: true,
        })
      } catch (writeError) {
        console.error('Failed to write log file:', writeError)
      }
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
   * @returns 日志文件内容
   */
  public async exportLogs(): Promise<string> {
    // 确保所有缓冲内容已写入
    await this.flushNow()

    try {
      const result = await Filesystem.readFile({
        path: LOG_FILE_NAME,
        directory: LOG_DIRECTORY,
        encoding: Encoding.UTF8,
      })
      return result.data as string
    } catch (error) {
      console.error('Failed to read log file:', error)
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
      await Filesystem.deleteFile({
        path: LOG_FILE_NAME,
        directory: LOG_DIRECTORY,
      })
    } catch (error) {
      // 文件不存在时忽略错误
    }
  }

  /**
   * 获取日志文件路径（用于调试）
   */
  public async getLogFilePath(): Promise<string> {
    try {
      const result = await Filesystem.getUri({
        path: LOG_FILE_NAME,
        directory: LOG_DIRECTORY,
      })
      return result.uri
    } catch (error) {
      return ''
    }
  }
}

export default MobileLogger.getInstance()
