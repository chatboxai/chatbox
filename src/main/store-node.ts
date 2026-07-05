import crypto from 'node:crypto'
import { app, powerMonitor, safeStorage } from 'electron'
import Store from 'electron-store'
import * as fs from 'fs-extra'
import path from 'path'
import sanitizeFilename from 'sanitize-filename'
import * as defaults from '../shared/defaults'
import type { Config, Settings } from '../shared/types'
import { getLogger } from './util'

const logger = getLogger('store-node')

if (process.env.WORKSPAICE_E2E_USER_DATA_DIR) {
  fs.ensureDirSync(process.env.WORKSPAICE_E2E_USER_DATA_DIR)
  app.setPath('userData', process.env.WORKSPAICE_E2E_USER_DATA_DIR)
  logger.info('using isolated E2E userData path:', process.env.WORKSPAICE_E2E_USER_DATA_DIR)
}

const configPath = path.resolve(app.getPath('userData'), 'config.json')
const configBackupFilenamePattern = /^config-backup-\d{4}-\d{2}-\d{2}T\d{2}_\d{2}_\d{2}\.\d{3}Z\.json$/
const encryptionKeyPath = path.resolve(app.getPath('userData'), '.config-key')

// SECURITY: config.json holds provider API keys. We encrypt it at rest via
// electron-store's `encryptionKey`, where the key itself is a random value
// protected by the OS keychain through Electron's safeStorage (so it is not
// hardcoded in the bundle). If safeStorage is unavailable (e.g. some Linux
// setups), we fall back to an unencrypted store rather than failing to launch.
//
// Migration is non-destructive: `conf` (electron-store's backend) returns the
// raw bytes when decryption fails, so a pre-existing plaintext config.json is
// read normally and transparently re-written encrypted on the next write.
//
// Since Electron 42, safeStorage.isEncryptionAvailable() returns false before
// the app 'ready' event (it returned true pre-ready on Electron 35), so the
// key — and therefore the store — must not be resolved at module load. Worse,
// constructing the store keyless against an existing *encrypted* config.json
// would trip clearInvalidConfig and wipe it. Hence the lazy initStore() below,
// which hard-fails on pre-ready access instead of silently degrading.
function resolveEncryptionKey(): string | undefined {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      logger.warn('safeStorage unavailable; config.json will be stored unencrypted')
      return undefined
    }
    if (fs.existsSync(encryptionKeyPath)) {
      try {
        const encrypted = fs.readFileSync(encryptionKeyPath) as Buffer
        const key = safeStorage.decryptString(encrypted)
        if (key) {
          return key
        }
        logger.warn('config key decrypted empty; regenerating')
      } catch (err) {
        logger.error('failed to decrypt existing config key; regenerating', err)
      }
    }
    const newKey = crypto.randomBytes(32).toString('hex')
    fs.writeFileSync(encryptionKeyPath, safeStorage.encryptString(newKey) as unknown as Uint8Array)
    return newKey
  } catch (err) {
    logger.error('failed to resolve config encryption key; storing config unencrypted', err)
    return undefined
  }
}

let encryptionKey: string | undefined

// Mirrors conf's on-disk format: [16-byte IV][':'][aes-256-cbc ciphertext],
// key = pbkdf2(encryptionKey, iv.toString(), 10000, 32, 'sha512'). Returns the
// decrypted plaintext, or null if the data is not in encrypted form.
function tryDecryptConfigBuffer(data: Buffer): string | null {
  if (!encryptionKey) {
    return null
  }
  try {
    if (data.length < 17 || data.slice(16, 17).toString() !== ':') {
      return null
    }
    const iv = data.subarray(0, 16) as unknown as Uint8Array
    const password = crypto.pbkdf2Sync(encryptionKey, iv.toString(), 10000, 32, 'sha512') as unknown as Uint8Array
    const decipher = crypto.createDecipheriv('aes-256-cbc', password, iv)
    const ciphertext = data.subarray(17) as unknown as Uint8Array
    const parts = [decipher.update(ciphertext), decipher.final()] as unknown as Uint8Array[]
    return Buffer.concat(parts).toString('utf8')
  } catch {
    return null
  }
}

// Returns true if a config-backup file is legacy plaintext (parses as JSON and
// is NOT in the encrypted IV-prefixed format). Used to purge plaintext backups
// that would otherwise leak API keys after encryption is enabled.
function isLegacyPlaintextConfigFile(filepath: string): boolean {
  try {
    const buf = fs.readFileSync(filepath)
    if (buf.length >= 17 && buf.slice(16, 17).toString() === ':' && tryDecryptConfigBuffer(buf) !== null) {
      return false // valid encrypted file
    }
    JSON.parse(buf.toString('utf8'))
    return true // parsed as plaintext JSON
  } catch {
    return false
  }
}

// One-time cleanup: once encryption is active, delete any plaintext backups
// (they contain unencrypted API keys). New backups copy the now-encrypted
// config.json and are therefore encrypted at rest.
function purgeLegacyPlaintextBackups() {
  if (!encryptionKey) {
    return
  }
  try {
    const userData = app.getPath('userData')
    const filenames = fs.readdirSync(userData)
    for (const filename of filenames) {
      if (!filename.startsWith('config-backup-') || !configBackupFilenamePattern.test(filename)) {
        continue
      }
      const filepath = path.resolve(userData, filename)
      if (isLegacyPlaintextConfigFile(filepath)) {
        try {
          fs.unlinkSync(filepath)
          logger.info('purged legacy plaintext config backup:', filename)
        } catch (err) {
          logger.warn('failed to purge legacy plaintext config backup:', filename, err)
        }
      }
    }
  } catch (err) {
    logger.error('failed to purge legacy plaintext backups:', err)
  }
}

interface StoreType {
  configVersion: number
  settings: Settings
  configs: Config
  lastShownAboutDialogVersion: string // 上次启动时自动弹出关于对话框的应用版本
}

let storeInstance: Store<StoreType> | undefined
let autoBackupTimer: ReturnType<typeof setInterval> | undefined

// Initializes the config store. Must be called (or first accessed via the
// `store` proxy) only after the app 'ready' event — call it at the top of
// app.whenReady() in main.ts. See the SECURITY note above for why pre-ready
// initialization is forbidden.
export function initStore(): Store<StoreType> {
  if (storeInstance) {
    return storeInstance
  }
  if (!app.isReady()) {
    throw new Error(
      'store-node accessed before app ready: on Electron >=42 safeStorage is unavailable pre-ready, ' +
        'and initializing the store without the encryption key would clear an encrypted config.json. ' +
        'Call initStore() from app.whenReady() before any store access.'
    )
  }

  // 1) 解析加密密钥
  encryptionKey = resolveEncryptionKey()

  // 2) 检查配置文件是否合法
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

  // 3) 初始化store
  storeInstance = new Store<StoreType>({
    clearInvalidConfig: true, // 当配置JSON不合法时，清空配置
    ...(encryptionKey ? { encryptionKey } : {}),
  })
  logger.info('init store, config path:', storeInstance.path, 'encrypted:', Boolean(encryptionKey))

  // Ensure the config is written back in encrypted form immediately after a
  // plaintext -> encrypted migration, then remove any plaintext backups.
  if (encryptionKey) {
    try {
      migratePlaintextConfigToEncrypted(storeInstance)
      purgeLegacyPlaintextBackups()
    } catch (err) {
      logger.error('post-init encryption migration step failed:', err)
    }
  }

  // 4) 启动自动备份，每10分钟备份一次，并自动清理多余的备份文件
  void autoBackup()
  autoBackupTimer = setInterval(autoBackup, 10 * 60 * 1000)
  powerMonitor.on('resume', () => {
    clearInterval(autoBackupTimer)
    autoBackupTimer = setInterval(autoBackup, 10 * 60 * 1000)
  })
  powerMonitor.on('suspend', () => {
    clearInterval(autoBackupTimer)
  })

  return storeInstance
}

// Lazy proxy so existing `store.get(...)` / `store.set(...)` call sites keep
// working unchanged; the first access initializes the real store (post-ready).
export const store: Store<StoreType> = new Proxy({} as Store<StoreType>, {
  get(_target, prop) {
    const s = initStore()
    const value = Reflect.get(s, prop, s)
    return typeof value === 'function' ? value.bind(s) : value
  },
  set(_target, prop, value) {
    const s = initStore()
    return Reflect.set(s, prop, value, s)
  },
  has(_target, prop) {
    return Reflect.has(initStore(), prop)
  },
})

// If config.json is still plaintext on disk (first launch after enabling
// encryption), force one rewrite through the store so it is persisted
// encrypted. Idempotent: subsequent launches see an encrypted file and skip.
function migratePlaintextConfigToEncrypted(s: Store<StoreType>) {
  if (!encryptionKey || !fs.existsSync(configPath)) {
    return
  }
  const buf = fs.readFileSync(configPath)
  const alreadyEncrypted =
    buf.length >= 17 && buf.slice(16, 17).toString() === ':' && tryDecryptConfigBuffer(buf) !== null
  if (alreadyEncrypted) {
    return
  }
  s.set(s.store)
  logger.info('migrated plaintext config.json to encrypted at rest')
}
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
  const settings = store.get<'settings'>('settings', defaults.settings())
  return settings
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
  let backupFileInfos = backupFilenames
    .filter((filename) => {
      if (!configBackupFilenamePattern.test(filename)) {
        logger.warn('Ignoring invalid config backup filename:', filename)
        return false
      }
      return true
    })
    .map((filename) => {
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
 * 清理备份文件：
 * 1. 对于今天和昨天，每小时保留最后一份备份。
 * 2. 对于昨天之前的 28 天内（即 3 天前到 30 天前），每天保留最后一份备份。
 * 3. 删除 30 天前的所有备份。
 */
export async function clearBackups() {
  const backups = getBackups() // Already sorted ascending by dateMs
  if (backups.length === 0) {
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
          if (!configBackupFilenamePattern.test(backup.filename)) {
            logger.warn('Skip deleting invalid config backup filename:', backup.filename)
            return
          }
          const expectedPath = path.resolve(app.getPath('userData'), backup.filename)
          if (backup.filepath !== expectedPath) {
            logger.warn('Skip deleting config backup with unexpected path:', backup.filepath)
            return
          }
          const stat = await fs.stat(backup.filepath).catch(() => null)
          if (!stat?.isFile()) {
            logger.warn('Skip deleting config backup because it is not a file:', backup.filepath)
            return
          }
          await fs.unlink(backup.filepath)
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
    const buf = fs.readFileSync(filepath)
    const decrypted = tryDecryptConfigBuffer(buf)
    // Validate either the decrypted payload (encrypted file) or the raw bytes
    // (legacy plaintext file). This keeps the backup-restore safety net working
    // after encryption is enabled instead of treating encrypted files as
    // "invalid" and clobbering them with stale plaintext backups.
    JSON.parse(decrypted ?? buf.toString('utf8'))
  } catch {
    return false
  }
  return true
}

export async function getStoreBlob(key: string) {
  const filename = path.resolve(app.getPath('userData'), 'workspaice-blobs', sanitizeFilename(key))
  const exists = await fs.pathExists(filename)
  if (!exists) {
    return null
  }
  return fs.readFile(filename, { encoding: 'utf-8' })
}

export async function setStoreBlob(key: string, value: string) {
  const filename = path.resolve(app.getPath('userData'), 'workspaice-blobs', sanitizeFilename(key))
  await fs.ensureDir(path.dirname(filename))
  return fs.writeFile(filename, value, { encoding: 'utf-8' })
}

export async function delStoreBlob(key: string) {
  const filename = path.resolve(app.getPath('userData'), 'workspaice-blobs', sanitizeFilename(key))
  const exists = await fs.pathExists(filename)
  if (!exists) {
    return
  }
  await fs.remove(filename)
}

export async function listStoreBlobKeys() {
  const dir = path.resolve(app.getPath('userData'), 'workspaice-blobs')
  const exists = await fs.pathExists(dir)
  if (!exists) {
    return []
  }
  return fs.readdir(dir)
}
