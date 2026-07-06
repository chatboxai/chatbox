import os from 'node:os'
import path from 'node:path'
import * as fs from 'fs-extra'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mutable state read by the electron mock. Hoisted so the (also hoisted)
// vi.mock factory can close over it. Each test resets it in beforeEach.
const state = vi.hoisted(() => ({
  userDataDir: '',
  isReady: true,
  encryptionAvailable: true,
}))

// Minimal electron surface store-node + electron-store need. safeStorage is
// simulated with a reversible "keychain" transform so the on-disk .config-key
// is opaque bytes but decrypts deterministically in-process.
vi.mock('electron', () => ({
  app: {
    getPath: (_name: string) => state.userDataDir,
    getVersion: () => '1.0.0-test',
    getName: () => 'workspaice-test',
    isReady: () => state.isReady,
    setPath: () => {},
    on: () => {},
  },
  ipcMain: { on: () => {}, handle: () => {} },
  safeStorage: {
    isEncryptionAvailable: () => state.encryptionAvailable,
    encryptString: (s: string) => Buffer.from(`kc:${s}`, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^kc:/, ''),
  },
  powerMonitor: { on: () => {} },
  shell: { openPath: () => Promise.resolve('') },
}))

vi.mock('./util', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// electron-store does `require('electron')` at load and derives its cwd from
// `app.getPath('userData')` — which vitest cannot intercept through it because
// the package is externalized. Back it with the real `conf` backend (so the
// encryption behaviour is exercised for real) but inject the current temp dir
// as cwd so nothing lands in the developer's real profile.
vi.mock('electron-store', async () => {
  const conf = (await vi.importActual<{ default: new (opts: object) => object }>('conf')).default
  return {
    default: class extends conf {
      constructor(opts: object) {
        super({ ...opts, cwd: state.userDataDir, configName: 'config', projectVersion: '1.0.0-test' })
      }
    },
  }
})

type StoreModule = typeof import('./store-node')

// Loads store-node fresh so its module-level configPath/encryptionKeyPath are
// captured against the current userDataDir. Must run after state is set.
function loadStore(): Promise<StoreModule> {
  vi.resetModules()
  return import('./store-node')
}

// config-backup filename for a given instant, matching store-node's own
// `new Date().toISOString().replace(/:/g, '_')` scheme.
function backupName(d: Date): string {
  return `config-backup-${d.toISOString().replace(/:/g, '_')}.json`
}

function writeBackup(d: Date, contents = '{"settings":{}}'): string {
  const p = path.join(state.userDataDir, backupName(d))
  fs.writeFileSync(p, contents)
  return p
}

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspaice-store-'))
  state.userDataDir = tmpDir
  state.isReady = true
  state.encryptionAvailable = true
})

afterEach(async () => {
  await fs.remove(tmpDir).catch(() => {})
})

describe('blob storage', () => {
  it('round-trips a blob through set/get', async () => {
    const store = await loadStore()
    await store.setStoreBlob('note', 'hello world')
    await expect(store.getStoreBlob('note')).resolves.toBe('hello world')
  })

  it('returns null for a missing blob', async () => {
    const store = await loadStore()
    await expect(store.getStoreBlob('does-not-exist')).resolves.toBeNull()
  })

  it('lists and deletes blob keys', async () => {
    const store = await loadStore()
    await store.setStoreBlob('a', '1')
    await store.setStoreBlob('b', '2')
    await expect(store.listStoreBlobKeys()).resolves.toEqual(expect.arrayContaining(['a', 'b']))

    await store.delStoreBlob('a')
    const keys = await store.listStoreBlobKeys()
    expect(keys).not.toContain('a')
    expect(keys).toContain('b')
  })

  it('deleting a missing blob is a no-op', async () => {
    const store = await loadStore()
    await expect(store.delStoreBlob('nope')).resolves.toBeUndefined()
  })

  it('sanitizes keys so path separators cannot escape the blob dir', async () => {
    const store = await loadStore()
    await store.setStoreBlob('../../escape', 'x')
    // sanitize-filename strips the path separators, so the same key still
    // resolves and everything stays inside workspaice-blobs.
    await expect(store.getStoreBlob('../../escape')).resolves.toBe('x')
    const blobDir = path.join(tmpDir, 'workspaice-blobs')
    const entries = await fs.readdir(blobDir)
    expect(entries).toHaveLength(1)
    expect(entries[0].includes('/') || entries[0].includes('\\')).toBe(false)
    // Nothing escaped one level up into the temp dir itself.
    expect(fs.existsSync(path.join(tmpDir, 'escape'))).toBe(false)
  })

  it('lists no keys before the blob dir exists', async () => {
    const store = await loadStore()
    await expect(store.listStoreBlobKeys()).resolves.toEqual([])
  })
})

describe('getBackups', () => {
  it('returns [] when there are no backups', async () => {
    const store = await loadStore()
    expect(store.getBackups()).toEqual([])
  })

  it('ignores non-backup files and malformed backup filenames', async () => {
    const store = await loadStore()
    fs.writeFileSync(path.join(tmpDir, 'config.json'), '{}')
    fs.writeFileSync(path.join(tmpDir, 'config-backup-not-a-date.json'), '{}')
    const valid = backupName(new Date('2026-01-02T03:04:05.006Z'))
    fs.writeFileSync(path.join(tmpDir, valid), '{}')

    const backups = store.getBackups()
    expect(backups.map((b) => b.filename)).toEqual([valid])
  })

  it('sorts backups ascending by timestamp', async () => {
    const store = await loadStore()
    const older = backupName(new Date('2026-01-01T00:00:00.000Z'))
    const newer = backupName(new Date('2026-06-01T00:00:00.000Z'))
    fs.writeFileSync(path.join(tmpDir, newer), '{}')
    fs.writeFileSync(path.join(tmpDir, older), '{}')

    expect(store.getBackups().map((b) => b.filename)).toEqual([older, newer])
  })
})

describe('needBackup', () => {
  it('is true with no backups', async () => {
    const store = await loadStore()
    expect(store.needBackup()).toBe(true)
  })

  it('is false when the latest backup is recent', async () => {
    const store = await loadStore()
    writeBackup(new Date(Date.now() - 60 * 1000)) // 1 min ago
    expect(store.needBackup()).toBe(false)
  })

  it('is true when the latest backup is older than 10 minutes', async () => {
    const store = await loadStore()
    writeBackup(new Date(Date.now() - 20 * 60 * 1000)) // 20 min ago
    expect(store.needBackup()).toBe(true)
  })
})

describe('backup', () => {
  it('skips when config.json is missing', async () => {
    const store = await loadStore()
    await expect(store.backup()).resolves.toBeUndefined()
    expect(store.getBackups()).toEqual([])
  })

  it('skips when config.json is invalid JSON', async () => {
    const store = await loadStore()
    fs.writeFileSync(path.join(tmpDir, 'config.json'), 'not json{')
    await expect(store.backup()).resolves.toBeUndefined()
    expect(store.getBackups()).toEqual([])
  })

  it('copies a valid plaintext config.json to a timestamped backup', async () => {
    const store = await loadStore()
    fs.writeFileSync(path.join(tmpDir, 'config.json'), '{"settings":{"a":1}}')
    const result = await store.backup()
    expect(result).toBeTruthy()
    const backups = store.getBackups()
    expect(backups).toHaveLength(1)
    expect(fs.readFileSync(backups[0].filepath, 'utf8')).toBe('{"settings":{"a":1}}')
  })
})

describe('clearBackups retention', () => {
  const day = 24 * 60 * 60 * 1000

  it('is a no-op when there are no backups', async () => {
    const store = await loadStore()
    await expect(store.clearBackups()).resolves.toBeUndefined()
  })

  it('keeps latest-per-hour recent, latest-per-day in the 30d window, and drops >30d', async () => {
    const store = await loadStore()

    // clearBackups buckets by UTC date/hour but bounds windows by local
    // midnight, so timestamps are built in UTC to stay timezone-robust.
    // Two backups in the current UTC hour -> hourly bucket keeps the later one.
    const nowD = new Date()
    const hourStart = Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth(), nowD.getUTCDate(), nowD.getUTCHours())
    const hourEarly = writeBackup(new Date(hourStart + 5 * 60 * 1000))
    const hourLate = writeBackup(new Date(hourStart + 15 * 60 * 1000))

    // Two backups on the same UTC day, 5 days ago (older than yesterday, inside
    // the 30-day window) -> daily bucket keeps the later one.
    const fiveD = new Date(Date.now() - 5 * day)
    const dayBase = Date.UTC(fiveD.getUTCFullYear(), fiveD.getUTCMonth(), fiveD.getUTCDate())
    const dayEarly = writeBackup(new Date(dayBase + 6 * 60 * 60 * 1000))
    const dayLate = writeBackup(new Date(dayBase + 9 * 60 * 60 * 1000))

    // 40 days ago -> beyond the 30-day window, deleted.
    const fortyDaysAgo = writeBackup(new Date(Date.now() - 40 * day))

    await store.clearBackups()

    const remaining = store.getBackups().map((b) => b.filepath)
    expect(remaining).toContain(hourLate)
    expect(remaining).toContain(dayLate)
    expect(remaining).not.toContain(hourEarly)
    expect(remaining).not.toContain(dayEarly)
    expect(remaining).not.toContain(fortyDaysAgo)
    expect(remaining).toHaveLength(2)
  })
})

describe('initStore', () => {
  it('throws when accessed before the app is ready', async () => {
    state.isReady = false
    const store = await loadStore()
    expect(() => store.initStore()).toThrow(/before app ready/)
  })

  it('returns the same singleton instance on repeated init', async () => {
    const store = await loadStore()
    // Seed a recent backup so the immediate autoBackup() is skipped.
    writeBackup(new Date())
    const a = store.initStore()
    const b = store.initStore()
    expect(a).toBe(b)
  })

  it('encrypts config.json at rest and writes the key file', async () => {
    const store = await loadStore()
    writeBackup(new Date())
    store.initStore()
    store.store.set('probe', 'secret-value')

    // Key file is present and the on-disk config is not readable plaintext JSON.
    expect(fs.existsSync(path.join(tmpDir, '.config-key'))).toBe(true)
    const raw = fs.readFileSync(path.join(tmpDir, 'config.json'))
    expect(() => JSON.parse(raw.toString('utf8'))).toThrow()
    // conf's at-rest format is [16-byte IV][':'][ciphertext].
    expect(raw.slice(16, 17).toString()).toBe(':')
    // A reader with the persisted key still gets the value back.
    expect(store.store.get('probe')).toBe('secret-value')
  })

  it('migrates a pre-existing plaintext config.json to encrypted', async () => {
    const store = await loadStore()
    fs.writeFileSync(path.join(tmpDir, 'config.json'), '{"settings":{},"foo":"bar"}')
    writeBackup(new Date())

    store.initStore()

    // Value survived the migration...
    expect(store.store.get('foo')).toBe('bar')
    // ...and the file on disk is now encrypted, not the original plaintext.
    const raw = fs.readFileSync(path.join(tmpDir, 'config.json'))
    expect(() => JSON.parse(raw.toString('utf8'))).toThrow()
  })

  it('purges legacy plaintext backups once encryption is active', async () => {
    const store = await loadStore()
    fs.writeFileSync(path.join(tmpDir, 'config.json'), '{"settings":{}}')
    // A plaintext backup dated now: recent enough that autoBackup() is skipped,
    // so the only reason it can disappear is the purge.
    const plaintextBackup = writeBackup(new Date(), '{"settings":{},"leaked":"key"}')
    expect(fs.existsSync(plaintextBackup)).toBe(true)

    store.initStore()

    expect(fs.existsSync(plaintextBackup)).toBe(false)
  })

  it('falls back to an unencrypted store when safeStorage is unavailable', async () => {
    state.encryptionAvailable = false
    const store = await loadStore()
    writeBackup(new Date())
    store.initStore()
    store.store.set('plain', 'value')

    expect(fs.existsSync(path.join(tmpDir, '.config-key'))).toBe(false)
    const raw = fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf8')
    // Readable plaintext JSON, round-trips the value.
    expect(JSON.parse(raw).plain).toBe('value')
    expect(store.store.get('plain')).toBe('value')
  })

  it('restores config.json from the newest valid backup when it is corrupt', async () => {
    state.encryptionAvailable = false
    const store = await loadStore()
    // Corrupt live config...
    fs.writeFileSync(path.join(tmpDir, 'config.json'), 'CORRUPT{{{')
    // ...older invalid backup and a newer valid one.
    fs.writeFileSync(path.join(tmpDir, backupName(new Date(Date.now() - 2 * 60 * 1000))), 'ALSO BAD{')
    const goodBackup = backupName(new Date(Date.now() - 60 * 1000))
    fs.writeFileSync(path.join(tmpDir, goodBackup), '{"settings":{},"restored":true}')

    store.initStore()

    expect(store.store.get('restored')).toBe(true)
  })
})

describe('getConfig / getSettings', () => {
  it('creates and persists a fresh configs object on first read', async () => {
    const store = await loadStore()
    writeBackup(new Date())
    store.initStore()

    const first = store.getConfig()
    expect(typeof first.uuid).toBe('string')
    // Persisted: a second read returns the same uuid.
    expect(store.getConfig().uuid).toBe(first.uuid)
  })

  it('returns default settings when none are stored', async () => {
    const store = await loadStore()
    writeBackup(new Date())
    store.initStore()
    expect(store.getSettings()).toBeTypeOf('object')
  })
})
