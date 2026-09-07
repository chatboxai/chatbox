import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  opened: false,
  values: new Map<string, string>(),
  closeConnection: vi.fn(),
  createConnection: vi.fn(),
  open: vi.fn(),
  execute: vi.fn(),
  run: vi.fn(),
  query: vi.fn(),
}))

vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {},
  // biome-ignore lint/complexity/useArrowFunction: SQLiteConnection is constructed with new.
  SQLiteConnection: vi.fn(function () {
    return { closeConnection: native.closeConnection, createConnection: native.createConnection }
  }),
}))
vi.mock('.', () => ({ default: { isDesktopLike: false, type: 'mobile' } }))
vi.mock('@/storage', () => ({ StorageKey: {} }))
vi.mock('@/utils/sentry', () => ({ reportError: vi.fn() }))

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function requireOpen() {
  if (!native.opened) throw new Error('database chatbox not opened')
}

beforeEach(() => {
  vi.resetModules()
  native.opened = false
  native.values.clear()
  native.closeConnection.mockReset().mockImplementation(async () => {
    native.opened = false
  })
  native.createConnection.mockReset().mockImplementation(async () => {
    native.opened = false
    return { open: native.open, execute: native.execute, run: native.run, query: native.query }
  })
  native.open.mockReset().mockImplementation(async () => {
    native.opened = true
  })
  native.execute.mockReset().mockImplementation(async () => {
    requireOpen()
    return { changes: { changes: 0 } }
  })
  native.run.mockReset().mockImplementation(async (statement: string, values: unknown[] = []) => {
    requireOpen()
    if (statement.includes('INSERT OR REPLACE INTO key_value')) {
      native.values.set(String(values[0]), String(values[1]))
    }
    return { changes: { changes: 0 } }
  })
  native.query.mockReset().mockImplementation(async (statement: string, values: unknown[] = []) => {
    requireOpen()
    if (statement.includes('SELECT DISTINCT key FROM key_value_chunks')) return { values: [] }
    if (statement.includes('SELECT key FROM key_value')) {
      return { values: Array.from(native.values.keys(), (key) => ({ key })) }
    }
    if (statement.includes('AS value_kind')) {
      const value = native.values.get(String(values[0]))
      return {
        values: value === undefined ? [] : [{ value, value_length: Buffer.byteLength(value), value_kind: 'complete' }],
      }
    }
    if (statement.includes('SELECT substr(value')) {
      const value = native.values.get(String(values[2]))
      return { values: value === undefined ? [] : [{ value }] }
    }
    throw new Error(`Unexpected query: ${statement}`)
  })
})

describe('mobile KV connection ownership', () => {
  it('waits for the previous native connection to close before creating one shared connection', async () => {
    const closing = deferred()
    native.closeConnection.mockImplementationOnce(() => closing.promise)
    const { MobileSQLiteStorage } = await import('./storages')
    const first = new MobileSQLiteStorage()
    const second = new MobileSQLiteStorage()
    expect(native.closeConnection).not.toHaveBeenCalled()

    const reads = Promise.all([first.getAllStoreKeys(), second.getAllStoreKeys()])
    try {
      await vi.waitFor(() => expect(native.closeConnection).toHaveBeenCalledTimes(1))
      expect(native.createConnection).not.toHaveBeenCalled()
    } finally {
      closing.resolve()
      await reads
    }
    expect(native.createConnection).toHaveBeenCalledTimes(1)
    expect(native.open).toHaveBeenCalledTimes(1)
    expect(native.execute).toHaveBeenCalledTimes(2)
  })

  it('keeps the live platform connection open while migration probes the same database', async () => {
    const { MobileSQLiteStorage, getOldVersionStorages } = await import('./storages')
    const platform = new MobileSQLiteStorage()
    await platform.setStoreValue('configVersion', 13)
    const migrationStorage = getOldVersionStorages().find((storage) => storage.getStorageType() === 'MOBILE_SQLITE')
    if (!migrationStorage) throw new Error('Missing mobile migration storage')

    const [keys, configVersion] = await Promise.all([
      platform.getAllStoreKeys(),
      migrationStorage.getStoreValue('configVersion'),
    ])
    expect(keys).toEqual(['configVersion'])
    expect(configVersion).toBe(13)
    expect(native.closeConnection).toHaveBeenCalledTimes(1)
    expect(native.createConnection).toHaveBeenCalledTimes(1)
    expect(native.open).toHaveBeenCalledTimes(1)
    expect(native.execute).toHaveBeenCalledTimes(2)
  })

  it('serializes same-key operations across platform and migration wrappers', async () => {
    const { MobileSQLiteStorage, getOldVersionStorages } = await import('./storages')
    const platform = new MobileSQLiteStorage()
    await platform.getAllStoreKeys()
    const migrationStorage = getOldVersionStorages().find((storage) => storage.getStorageType() === 'MOBILE_SQLITE')
    if (!migrationStorage) throw new Error('Missing mobile migration storage')
    const entered = deferred()
    const writing = deferred()
    native.run.mockImplementationOnce(async (_statement: string, values: unknown[]) => {
      entered.resolve()
      await writing.promise
      requireOpen()
      native.values.set(String(values[0]), String(values[1]))
      return { changes: { changes: 1 } }
    })
    const write = platform.setStoreValue('configVersion', 14)
    await entered.promise
    native.query.mockClear()
    const read = migrationStorage.getStoreValue('configVersion')
    try {
      // Let the read reach its per-key queue while the write remains blocked.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(native.query).not.toHaveBeenCalled()
    } finally {
      writing.resolve()
      await write
    }
    expect(await read).toBe(14)
  })

  it('opens a fresh database when no previous native connection exists', async () => {
    native.closeConnection.mockRejectedValueOnce(new Error('No available connection'))
    const { MobileSQLiteStorage } = await import('./storages')
    await expect(new MobileSQLiteStorage().getAllStoreKeys()).resolves.toEqual([])
    expect(native.createConnection).toHaveBeenCalledTimes(1)
    expect(native.open).toHaveBeenCalledTimes(1)
  })

  it.each(['create', 'open', 'schema'] as const)('retries a failed %s once for all wrappers', async (step) => {
    const failure = new Error(`${step} failed`)
    const failingOperation = { create: native.createConnection, open: native.open, schema: native.execute }[step]
    failingOperation.mockRejectedValueOnce(failure)
    const { MobileSQLiteStorage } = await import('./storages')
    const first = new MobileSQLiteStorage()
    const second = new MobileSQLiteStorage()
    const results = await Promise.allSettled([first.getAllStoreKeys(), second.getAllStoreKeys()])
    expect(results).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ])

    await expect(Promise.all([first.getAllStoreKeys(), second.getAllStoreKeys()])).resolves.toEqual([[], []])
    expect(native.closeConnection).toHaveBeenCalledTimes(2)
    expect(native.createConnection).toHaveBeenCalledTimes(2)
  })
})
