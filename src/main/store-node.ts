import { app, powerMonitor } from 'electron'
import Store from 'electron-store'
import * as fs from 'fs-extra'
import path from 'path'
import sanitizeFilename from 'sanitize-filename'
import * as defaults from '../shared/defaults'
import type { Config, Settings } from '../shared/types'
import { getLogger } from './util'

const logger = getLogger('store-node')

const configPath = path.resolve(app.getPath('userData'), 'config.json')

// 1) 检查配置文件是否合法
// 如果配置文件不合法，则使用最新的备份文件
if (fs.existsSync(configPath) && !checkConfigValid(configPath)) {
  logger.error('config.json is invalid.')
  const backups = getBackups()
  if (backups.length > 0) {
    // 不断尝试使用最新的备份文件，直到成功
    for (let i = backups.length - 1; i >= 0; i--) {
      const backup = backups[i]
      if (checkConfigValid(backup.filepath)) {
        fs.copySync(backup.filepath, configPath)
        logger.info('use backup:', backup.filepath)
        break
      }
    }
  }
}

// 2) 初始化store
interface StoreType {
  configVersion: number
  settings: Settings
  configs: Config
  lastShownAboutDialogVersion: string // 上次启动时自动弹出关于对话框的应用版本
}
export const store = new Store<StoreType>({
  clearInvalidConfig: true, // 当配置JSON不合法时，清空配置
})
logger.info('init store, config path:', store.path)

// 3) 启动自动备份，每10分钟备份一次，并自动清理多余的备份文件
autoBackup()
let autoBackupTimer = setInterval(autoBackup, 10 * 60 * 1000)
powerMonitor.on('resume', () => {
  clearInterval(autoBackupTimer)
  autoBackupTimer = setInterval(autoBackup, 10 * 60 * 1000)
})
powerMonitor.on('suspend', () => {
  clearInterval(autoBackupTimer)
})
async function autoBackup() {
  try {
    if (needBackup()) {
      const filename = await backup()
      if (filename) {
        logger.info('auto backup:', filename)
      }
    }
    await clearBackups()
  } catch (err) {
    logger.error('auto backup error:', err)
  }
}

export function getSettings(): Settings {
  const fallbackSettings = defaults.settings()
  const settings = store.get<'settings'>('settings', fallbackSettings)

  if (settings) {
    return settings
  }

  store.set<'settings'>('settings', fallbackSettings)
  return fallbackSettings
}

export function getConfig(): Config {
  let configs = store.get<'configs'>('configs')
  if (!configs) {
    configs = defaults.newConfigs()
    store.set<'configs'>('configs', configs)
  }
  return configs
}

/**
 * 备份配置文件
 */
export async function backup() {
  if (!fs.existsSync(configPath)) {
    logger.error('skip backup because config.json does not exist.')
    return
  }
  if (!checkConfigValid(configPath)) {
    logger.error('skip backup because config.json is invalid.')
    return
  }
  const now = new Date().toISOString().replace(/:/g, '_')
  const backupPath = path.resolve(app.getPath('userData'), `config-backup-${now}.json`)
  try {
    await fs.copy(configPath, backupPath)
  } catch (err) {
    logger.error('Failed to backup config:', err)
    return
  }
  logger.info('backup config to:', backupPath)
  return backupPath
}

/**
 * 获取所有备份文件，并按照时间排序
 * @returns 备份文件信息
 */
export function getBackups() {
  const filenames = fs.readdirSync(app.getPath('userData'))
  const backupFilenames = filenames.filter((filename) => filename.startsWith('config-backup-'))
  if (backupFilenames.length === 0) {
    return []
  }
  let backupFileInfos = backupFilenames.map((filename) => {
    let dateStr = filename.replace('config-backup-', '').replace('.json', '')
    dateStr = dateStr.replace(/_/g, ':')
    const date = new Date(dateStr)
    return {
      filename,
      filepath: path.resolve(app.getPath('userData'), filename),
      dateMs: date.getTime() || 0,
    }
  })
  backupFileInfos = backupFileInfos.sort((a, b) => a.dateMs - b.dateMs)
  return backupFileInfos
}

/**
 * 检查是否需要备份
 * @returns 是否需要备份
 */
export function needBackup() {
  const backups = getBackups()
  if (backups.length === 0) {
    return true
  }
  const lastBackup = backups[backups.length - 1]
  return lastBackup.dateMs < Date.now() - 10 * 60 * 1000 // 10分钟备份一次
}

/**
 * 清理备份文件，仅保留最近50个备份
 */
export async function clearBackups() {
  const limit = 50
  const backups = getBackups()
  if (backups.length < limit) {
    return
  }

  const now = new Date()
  const todayStartMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStartMs = todayStartMs - 24 * 60 * 60 * 1000
  const thirtyDaysAgoStartMs = todayStartMs - 30 * 24 * 60 * 60 * 1000

  const backupsToDelete: { filename: string; filepath: string }[] = []
  const keptHourlyBackups: { [hourKey: string]: { filename: string; filepath: string } } = {} // Key: YYYY-MM-DD-HH
  const keptDailyBackups: { [dateKey: string]: { filename: string; filepath: string } } = {} // Key: YYYY-MM-DD

  for (const backup of backups) {
    const backupDate = new Date(backup.dateMs)
    const dateKey = backupDate.toISOString().slice(0, 10) // YYYY-MM-DD
    const hourKey = `${dateKey}-${backupDate.toISOString().slice(11, 13)}` // YYYY-MM-DD-HH

    if (backup.dateMs < thirtyDaysAgoStartMs) {
      // Older than 30 days: mark for deletion
      backupsToDelete.push({ filename: backup.filename, filepath: backup.filepath })
    } else if (backup.dateMs < yesterdayStartMs) {
      // Between 30 days ago and yesterday (exclusive): keep latest per day
      const existingKept = keptDailyBackups[dateKey]
      if (existingKept) {
        // A backup for this day was already kept; mark the older one for deletion
        backupsToDelete.push(existingKept)
      }
      // Keep the current one (it's the latest encountered for this day so far)
      keptDailyBackups[dateKey] = { filename: backup.filename, filepath: backup.filepath }
    } else {
      // Today or yesterday: keep latest per hour
      const existingKept = keptHourlyBackups[hourKey]
      if (existingKept) {
        // A backup for this hour was already kept; mark the older one for deletion
        backupsToDelete.push(existingKept)
      }
      // Keep the current one (it's the latest encountered for this hour so far)
      keptHourlyBackups[hourKey] = { filename: backup.filename, filepath: backup.filepath }
    }
  }

  // Perform the actual deletions
  if (backupsToDelete.length > 0) {
    logger.info(`Clearing ${backupsToDelete.length} old backup(s)...`)
    try {
      await Promise.all(
        backupsToDelete.map(async (backup) => {
          await fs.remove(backup.filepath)
          // logger.info('clear backup:', backup.filename) // Log per file might be too verbose
        })
      )
      logger.info('Finished clearing old backups.')
    } catch (err) {
      logger.error('Failed to clear some backups:', err)
    }
  }
}

/**
 * 检查配置文件是否是合法的JSON文件
 * @returns 配置文件是否合法
 */
function checkConfigValid(filepath: string) {
  try {
    JSON.parse(fs.readFileSync(filepath, 'utf8'))
  } catch (err) {
    return false
  }
  return true
}

export async function getStoreBlob(key: string) {
  const filename = path.resolve(app.getPath('userData'), 'chatbox-blobs', sanitizeFilename(key))
  const exists = await fs.pathExists(filename)
  if (!exists) {
    return null
  }
  return fs.readFile(filename, { encoding: 'utf-8' })
}

export async function setStoreBlob(key: string, value: string) {
  const filename = path.resolve(app.getPath('userData'), 'chatbox-blobs', sanitizeFilename(key))
  await fs.ensureDir(path.dirname(filename))
  return fs.writeFile(filename, value, { encoding: 'utf-8' })
}

export async function delStoreBlob(key: string) {
  const filename = path.resolve(app.getPath('userData'), 'chatbox-blobs', sanitizeFilename(key))
  const exists = await fs.pathExists(filename)
  if (!exists) {
    return
  }
  await fs.remove(filename)
}

export async function listStoreBlobKeys() {
  const dir = path.resolve(app.getPath('userData'), 'chatbox-blobs')
  const exists = await fs.pathExists(dir)
  if (!exists) {
    return []
  }
  return fs.readdir(dir)
}
