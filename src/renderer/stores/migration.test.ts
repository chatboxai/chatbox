import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Storage Migration History:
 *
 * v1.9.8 - v1.9.10 (config version 0-5)
 *   - Mobile: localStorage - all data in browser localStorage
 *   - Web: IndexedDB
 *   - Desktop: Single config.json file (IPC) - all data in one file
 *
 * v1.9.11 (config version 6-7)
 *   - Mobile migrated to SQLite
 *   - (Only mobile release, desktop first update was v1.10.0)
 *
 * v1.12.0 (config version 7-8)
 *   - Data format: sessions → session-list migration
 *
 * v1.13.1 (config version 9-10)
 *   - Data format: Storage structure refactoring
 *
 * v1.16.1 (config version 11-12)
 *   - Mobile: Fully migrated to IndexedDB - all data in IndexedDB
 *   - Desktop: Split storage - sessions in IndexedDB, configs/settings/configVersion stay in IPC file
 *
 * v1.17.0 (config version 12-13) [CURRENT]
 *   - Mobile: Migrated to SQLite for better performance - all data in SQLite
 *   - Desktop: No change from v1.16.1 - sessions in IndexedDB, configs/settings/configVersion in IPC file
 *
 * Key Points:
 *   - Desktop has ALWAYS kept configVersion/settings/configs in file storage (never in IndexedDB)
 *   - Desktop only moved session data to IndexedDB in v1.16.1
 *   - Mobile storage evolution: localStorage → SQLite (v1.9.11) → IndexedDB (v1.16.1) → SQLite (v1.17.0)
 *
 * Migration Logic:
 *   - Detect old storage locations (localStorage/IPC file/IndexedDB/SQLite)
 *   - Copy data to new storage only if storage type changed
 *   - Clear old storage after successful migration
 *   - Handle multiple old storages (pick the newest one based on configVersion)
 *   - Skip migration if storage type hasn't changed (avoid unnecessary data copying)
 */

// Storage data type
type StorageData = { [key: string]: string }

// 只导入需要的类型
const StorageKey = {
  ConfigVersion: 'configVersion',
  ChatSessions: 'chat-sessions',
  ChatSessionsList: 'chat-sessions-list',
  Settings: 'settings',
  Configs: 'configs',
} as const

// Bottom-layer storage data containers
// These represent the actual data stored in different storage backends
let localforageData: Record<string, string> = {}
let ipcFileData: Record<string, string> = {}
let sqliteData: Record<string, string> = {} // Mobile SQLite database
let localStorageData: Record<string, string> = {} // Mobile SQLite database

// Helper function to create old storage mock based on storage type
// This ensures old storage mocks match the actual storage implementations
function createOldStorageMock(
  type: 'DESKTOP_FILE' | 'INDEXEDDB' | 'LOCAL_STORAGE' | 'MOBILE_SQLITE',
  data: StorageData
) {
  // For DESKTOP_FILE: Data is stored in a single config.json file accessed via IPC
  // For INDEXEDDB: Data is stored in browser IndexedDB via localforage
  // For LOCAL_STORAGE: Data is stored in browser localStorage (legacy web)
  // For MOBILE_SQLITE: Data is stored in mobile SQLite database

  // Common storage operations factory
  const createStorageMock = (storageData: StorageData) => ({
    getStorageType: () => type,
    setStoreValue: vi.fn((key: string, value: unknown) => {
      storageData[key] = JSON.stringify(value)
      return Promise.resolve()
    }),
    getStoreValue: vi.fn((key: string) => {
      const val = storageData[key]
      return Promise.resolve(val ? JSON.parse(val) : null)
    }),
    delStoreValue: vi.fn((key: string) => {
      delete storageData[key]
      return Promise.resolve()
    }),
    getAllStoreValues: vi.fn(() => {
      const result: StorageData = {}
      for (const [key, value] of Object.entries(storageData)) {
        result[key] = JSON.parse(value)
      }
      return Promise.resolve(result)
    }),
    getAllStoreKeys: vi.fn(() => Promise.resolve(Object.keys(storageData))),
    setAllStoreValues: vi.fn(),
  })

  if (type === 'DESKTOP_FILE') {
    // Desktop file storage: all data in one JSON file (independent copy)
    ipcFileData = { ...data }
    return createStorageMock(ipcFileData)
  } else if (type === 'INDEXEDDB') {
    // IndexedDB storage: data stored via localforage (shared with current storage)
    // Populate localforageData with initial data
    for (const [key, value] of Object.entries(data)) {
      localforageData[key] = value
    }
    return createStorageMock(localforageData)
  } else if (type === 'LOCAL_STORAGE') {
    // Local storage: data stored in browser localStorage (independent copy for testing)
    localStorageData = { ...data }
    return createStorageMock(localStorageData)
  } else if (type === 'MOBILE_SQLITE') {
    // Mobile SQLite storage: data stored in SQLite database (independent copy)
    sqliteData = { ...data }
    return createStorageMock(sqliteData)
  }

  // Fallback for other types (not implemented in current tests)
  return {
    getStorageType: () => type,
    setStoreValue: vi.fn(),
    getStoreValue: vi.fn().mockResolvedValue(null),
    delStoreValue: vi.fn(),
    getAllStoreValues: vi.fn().mockResolvedValue({}),
    getAllStoreKeys: vi.fn().mockResolvedValue([]),
    setAllStoreValues: vi.fn(),
  }
}

// Create mock localforage instance
const mockLocalforageInstance = {
  getItem: vi.fn((key: string) => {
    const value = localforageData[key]
    return Promise.resolve(value ?? null)
  }),
  setItem: vi.fn((key: string, value: string) => {
    localforageData[key] = value
    return Promise.resolve(undefined)
  }),
  removeItem: vi.fn((key: string) => {
    delete localforageData[key]
    return Promise.resolve(undefined)
  }),
  keys: vi.fn(() => {
    return Promise.resolve(Object.keys(localforageData))
  }),
  iterate: vi.fn((callback: (value: string, key: string) => void) => {
    for (const [key, value] of Object.entries(localforageData)) {
      callback(value, key)
    }
    return Promise.resolve()
  }),
}

// Create mock IPC invoke
const mockIpcInvoke = vi.fn((channel: string, ...args: unknown[]) => {
  if (channel === 'getStoreValue') {
    const key = args[0] as string
    const value = ipcFileData[key]
    return Promise.resolve(value ?? null)
  }
  if (channel === 'setStoreValue') {
    const [key, value] = args as [string, string]
    ipcFileData[key] = value
    return Promise.resolve(undefined)
  }
  if (channel === 'delStoreValue') {
    const key = args[0] as string
    delete ipcFileData[key]
    return Promise.resolve(undefined)
  }
  if (channel === 'getAllStoreValues') {
    const result: { [key: string]: unknown } = {}
    for (const [key, value] of Object.entries(ipcFileData)) {
      try {
        result[key] = JSON.parse(value)
      } catch {
        result[key] = value
      }
    }
    return Promise.resolve(JSON.stringify(result))
  }
  if (channel === 'getAllStoreKeys') {
    return Promise.resolve(Object.keys(ipcFileData))
  }
  // Default handlers for other IPC calls
  if (channel === 'getVersion') return Promise.resolve('1.0.0')
  if (channel === 'getPlatform') return Promise.resolve('desktop')
  if (channel === 'getArch') return Promise.resolve('x64')
  if (channel === 'getHostname') return Promise.resolve('test-host')
  if (channel === 'getLocale') return Promise.resolve('en-US')

  return Promise.resolve(undefined)
})

// Setup global mocks before any imports
global.window = {
  desktopAPI: {
    invoke: mockIpcInvoke,
    onWindowMaximizedChanged: vi.fn(() => () => {}),
  },
} as never

global.localStorage = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  key: vi.fn(),
  length: 0,
}

// Platform implementations will be dynamically imported
import type { Platform } from '@/platform/interfaces'

// Current platform and instances - will be initialized after mocks
let currentPlatform: Platform
let desktopPlatform: Platform
let mobilePlatform: Platform

// Mock @/platform to return our platform instance
vi.mock('@/platform', () => ({
  get default() {
    return currentPlatform
  },
}))

// Mock localforage
vi.mock('localforage', () => ({
  default: {
    createInstance: vi.fn(() => mockLocalforageInstance),
  },
}))

// Mock Capacitor modules to avoid "document is not defined" errors
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(() => ({ remove: vi.fn() })),
    getInfo: vi.fn(() => Promise.resolve({ version: '1.0.0', build: '1' })),
    getLaunchUrl: vi.fn(() => Promise.resolve(null)),
  },
}))

vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {},
  SQLiteConnection: vi.fn(),
}))

// Mock only external dependencies, not storage or platform
vi.mock('@/setup/init_data', () => ({
  initData: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../platform/storages', () => ({
  getOldVersionStorages: vi.fn(() => []),
  DesktopFileStorage: vi.fn(),
  LocalStorage: vi.fn(),
  IndexedDBStorage: vi.fn(),
  MobileSQLiteStorage: class MockMobileSQLiteStorage {
    getStorageType() {
      return 'MOBILE_SQLITE'
    }
    setStoreValue(key: string, value: unknown) {
      sqliteData[key] = JSON.stringify(value)
      return Promise.resolve()
    }
    getStoreValue(key: string) {
      const json = sqliteData[key]
      return Promise.resolve(json ? JSON.parse(json) : null)
    }
    delStoreValue(key: string) {
      delete sqliteData[key]
      return Promise.resolve()
    }
    getAllStoreValues() {
      const items: { [key: string]: unknown } = {}
      for (const key in sqliteData) {
        try {
          items[key] = JSON.parse(sqliteData[key])
        } catch {
          items[key] = sqliteData[key]
        }
      }
      return Promise.resolve(items)
    }
    getAllStoreKeys() {
      return Promise.resolve(Object.keys(sqliteData))
    }
    async setAllStoreValues(data: { [key: string]: unknown }) {
      for (const [key, value] of Object.entries(data)) {
        await this.setStoreValue(key, value)
      }
    }
  },
}))

vi.mock('../../shared/defaults', () => ({
  settings: vi.fn(() => ({})),
  SystemProviders: vi.fn(() => []),
}))

vi.mock('../lib/utils', () => ({
  getLogger: () => ({
    info: (...args: unknown[]) => console.log(...args),
    error: vi.fn(),
  }),
}))

vi.mock('./atoms/utilAtoms', () => ({
  migrationProcessAtom: {},
}))

vi.mock('./sessionHelpers', () => ({
  getSessionMeta: vi.fn((session) => ({
    id: session.id,
    name: session.name,
  })),
}))

vi.mock('@/platform/web_platform', () => ({
  default: vi.fn(),
}))

vi.mock('@sentry/react', () => ({
  getCurrentScope: () => ({
    setTag: vi.fn(),
  }),
}))

vi.mock('jotai', () => ({
  getDefaultStore: vi.fn(() => ({
    set: vi.fn(),
    get: vi.fn(() => []),
  })),
}))

vi.mock('store', () => ({
  default: {
    each: vi.fn(),
    get: vi.fn(),
    remove: vi.fn(),
  },
}))

vi.mock('@/packages/initial_data', () => ({
  artifactSessionCN: { id: 'artifact-cn' },
  artifactSessionEN: { id: 'artifact-en' },
  defaultSessionsForCN: [],
  defaultSessionsForEN: [],
  imageCreatorSessionForCN: { id: 'image-cn' },
  imageCreatorSessionForEN: { id: 'image-en' },
  mermaidSessionCN: { id: 'mermaid-cn' },
  mermaidSessionEN: { id: 'mermaid-en' },
}))

vi.mock('@shared/utils/cache', () => ({
  cache: vi.fn((_key: string, fn: () => Promise<unknown>) => fn()),
}))

vi.mock('@/i18n/parser', () => ({
  parseLocale: vi.fn((locale: string) => locale),
}))

vi.mock('../packages/navigator', () => ({
  getOS: vi.fn(() => 'test-os'),
  getBrowser: vi.fn(() => 'test-browser'),
}))

describe('migrateStorage test', () => {
  // Initialize platform instances after all mocks are set up
  beforeAll(async () => {
    const { default: DesktopPlatformClass } = await import('@/platform/desktop_platform')
    const { default: MobilePlatformClass } = await import('@/platform/mobile_platform')

    desktopPlatform = new DesktopPlatformClass(window.desktopAPI)
    mobilePlatform = new MobilePlatformClass()
    currentPlatform = desktopPlatform
  })

  beforeEach(() => {
    vi.clearAllMocks()
    // Clear all storage data before each test
    localforageData = {}
    ipcFileData = {}
    sqliteData = {}
    // Reset to default desktop platform
    currentPlatform = desktopPlatform
  })

  it('should skip migration when config version is already current', async () => {
    const { initData } = await import('@/setup/init_data')

    // Setup: Desktop v1.17.0 - configVersion = 13 (current) in IPC file storage
    ipcFileData[StorageKey.ConfigVersion] = JSON.stringify(13)

    const migration = await import('./migration')
    await migration._migrateStorageForTest()

    // Should not initialize data or set version when already at current version
    expect(initData).not.toHaveBeenCalled()
    // configVersion should remain 13
    expect(ipcFileData[StorageKey.ConfigVersion]).toBe(JSON.stringify(13))
  })

  it('should initialize data on first run (configVersion = 0, no old storage)', async () => {
    const { getOldVersionStorages } = await import('../platform/storages')
    const { initData } = await import('@/setup/init_data')

    // Setup: First run - no data in any storage
    // All storage containers are empty

    // No old storage with data

    ;(getOldVersionStorages as ReturnType<typeof vi.fn>).mockReturnValueOnce([])

    const migration = await import('./migration')
    await migration._migrateStorageForTest()

    // Should set current version (13) to IPC file storage (Desktop platform)
    expect(ipcFileData[StorageKey.ConfigVersion]).toBe(JSON.stringify(13))
    expect(initData).toHaveBeenCalled()
  })

  it('should not migrate when old storage type matches current storage type', async () => {
    const { getOldVersionStorages } = await import('../platform/storages')
    const { initData } = await import('@/setup/init_data')

    // Desktop platform already set in beforeEach

    // Setup: Simulating upgrade from v1.16.1 to v1.17.0
    // v1.16.1 Desktop: configVersion/settings/configs in file, sessions in IndexedDB
    // v1.17.0 Desktop: Same as v1.16.1 (no change in storage strategy)

    // Old IndexedDB storage (v1.16.1) - only has session data
    const oldIndexedDBData: StorageData = {
      [StorageKey.ChatSessionsList]: JSON.stringify([{ id: '1' }, { id: '2' }]),
      'session:1': JSON.stringify({ id: '1', name: 'Session 1', messages: [] }),
      'session:2': JSON.stringify({ id: '2', name: 'Session 2', messages: [] }),
    }

    // v1.17.0: configVersion/settings/configs stay in file storage (unchanged from v1.16.1)
    ipcFileData[StorageKey.ConfigVersion] = JSON.stringify(12)
    ipcFileData[StorageKey.Settings] = JSON.stringify({ theme: 'dark' })
    ipcFileData[StorageKey.Configs] = JSON.stringify({ apiKey: 'test-key' })

    const mockOldStorage = createOldStorageMock('INDEXEDDB', oldIndexedDBData)
    ;(getOldVersionStorages as ReturnType<typeof vi.fn>).mockReturnValueOnce([mockOldStorage])

    const migration = await import('./migration')
    await migration._migrateStorageForTest()

    // Should NOT migrate when storage types are the same (both INDEXEDDB for sessions)
    // The session data in IndexedDB is already accessible to current storage
    expect(mockOldStorage.getAllStoreValues).not.toHaveBeenCalled()
    expect(mockOldStorage.delStoreValue).not.toHaveBeenCalled()

    // configVersion is 12 (from file storage), not 0, so no initData
    expect(initData).not.toHaveBeenCalled()

    // Session data is already accessible through shared IndexedDB (localforageData)
    expect(localforageData[StorageKey.ChatSessionsList]).toBeDefined()
    expect(localforageData['session:1']).toBeDefined()
    expect(localforageData['session:2']).toBeDefined()
  })

  it('should migrate from desktop file storage (v1.9.x) to v1.17.0', async () => {
    const { getOldVersionStorages } = await import('../platform/storages')
    const { initData } = await import('@/setup/init_data')

    // Desktop platform already set in beforeEach

    // Setup: Desktop v1.9.x used single config.json file (DESKTOP_FILE)
    // Old storage: DESKTOP_FILE with all data in one place
    const oldFileData: StorageData = {
      [StorageKey.ConfigVersion]: JSON.stringify(5),
      [StorageKey.Settings]: JSON.stringify({ theme: 'dark', language: 'en' }),
      [StorageKey.Configs]: JSON.stringify({ apiKey: 'test-key' }),
      [StorageKey.ChatSessionsList]: JSON.stringify([{ id: '1' }, { id: '2' }]),
      'session:1': JSON.stringify({ id: '1', name: 'Session 1', messages: [] }),
      'session:2': JSON.stringify({ id: '2', name: 'Session 2', messages: [] }),
      'some-other-key': JSON.stringify({ data: 'value' }),
    }

    const mockOldStorage = createOldStorageMock('DESKTOP_FILE', oldFileData)
    ;(getOldVersionStorages as ReturnType<typeof vi.fn>).mockReturnValueOnce([mockOldStorage])

    const migration = await import('./migration')
    await migration._migrateStorageForTest()

    // Should get all values from old storage
    expect(mockOldStorage.getAllStoreValues).toHaveBeenCalled()

    // In v1.17.0: settings, configs, configVersion should stay in file (IPC)
    // They should NOT be migrated to IndexedDB
    const localforageKeys = Object.keys(localforageData)
    expect(localforageKeys).not.toContain(StorageKey.Settings)
    expect(localforageKeys).not.toContain(StorageKey.Configs)
    expect(localforageKeys).not.toContain(StorageKey.ConfigVersion)

    // Session data should be migrated to IndexedDB
    expect(localforageKeys).toContain(StorageKey.ChatSessionsList)
    expect(localforageKeys).toContain('session:1')
    expect(localforageKeys).toContain('session:2')
    expect(localforageKeys).toContain('some-other-key')

    // Only session-related keys should be deleted from old storage
    // Settings, configs, configVersion are NOT deleted because they stay in file storage
    const deletedKeys = mockOldStorage.delStoreValue.mock.calls.map((call: unknown[]) => call[0])
    expect(deletedKeys).toContain(StorageKey.ChatSessionsList)
    expect(deletedKeys).toContain('session:1')
    expect(deletedKeys).toContain('session:2')
    expect(deletedKeys).toContain('some-other-key')

    // These should NOT be deleted because they stay in file storage
    expect(deletedKeys).not.toContain(StorageKey.Settings)
    expect(deletedKeys).not.toContain(StorageKey.Configs)
    expect(deletedKeys).not.toContain(StorageKey.ConfigVersion)

    // Should mark as migrated in old storage
    expect(mockOldStorage.setStoreValue).toHaveBeenCalledWith(
      'migrated',
      expect.stringContaining('migrated from DESKTOP_FILE to INDEXEDDB')
    )

    expect(initData).not.toHaveBeenCalled()
  })

  it('should skip migration when old storage has same type as current storage', async () => {
    const { getOldVersionStorages } = await import('../platform/storages')
    const { initData } = await import('@/setup/init_data')

    // Setup: Switch to Mobile platform
    currentPlatform = mobilePlatform

    // Current storage already has some version (simulating an existing installation)
    sqliteData[StorageKey.ConfigVersion] = JSON.stringify(12)

    // Old storage is also MOBILE_SQLITE (same type)
    // In this test, we simulate finding an old storage with different version
    // (In reality, if they're the same type, they'd read the same data source,
    //  but for testing the skip logic, we use separate data containers)
    const oldStorageData: StorageData = {
      [StorageKey.ConfigVersion]: JSON.stringify(12),
      [StorageKey.Settings]: JSON.stringify({ theme: 'light' }),
      [StorageKey.Configs]: JSON.stringify({ apiKey: 'old-key' }),
    }

    const mockOldStorage = createOldStorageMock('MOBILE_SQLITE', oldStorageData)
    ;(getOldVersionStorages as ReturnType<typeof vi.fn>).mockReturnValueOnce([mockOldStorage])

    const migration = await import('./migration')

    await migration._migrateStorageForTest()

    // For mobile platform, migration uses getAllStoreKeys and getStoreValue
    expect(mockOldStorage.getStoreValue).toHaveBeenCalledExactlyOnceWith(StorageKey.ConfigVersion)
    expect(mockOldStorage.getAllStoreKeys).not.toHaveBeenCalled()
    expect(mockOldStorage.setStoreValue).not.toHaveBeenCalled()
    expect(mockOldStorage.setAllStoreValues).not.toHaveBeenCalled()
    expect(initData).not.toHaveBeenCalled()
  })

  it('should migrate from localStorage (v1.9.8) to SQLite (v1.17.0) on mobile', async () => {
    const { getOldVersionStorages } = await import('../platform/storages')
    const { initData } = await import('@/setup/init_data')

    // Setup: Switch to Mobile platform
    currentPlatform = mobilePlatform

    // Setup: Mobile v1.9.8 used localStorage with config version 5
    // This simulates a user upgrading directly from v1.9.8 to v1.17.0
    const oldLocalStorageData: StorageData = {
      [StorageKey.ConfigVersion]: JSON.stringify(5),
      [StorageKey.Settings]: JSON.stringify({ theme: 'dark', language: 'en' }),
      [StorageKey.Configs]: JSON.stringify({ apiKey: 'test-key' }),
      [StorageKey.ChatSessionsList]: JSON.stringify([{ id: '1' }, { id: '2' }]),
      'session:1': JSON.stringify({ id: '1', name: 'Chat 1', messages: [] }),
      'session:2': JSON.stringify({ id: '2', name: 'Chat 2', messages: [] }),
    }

    const mockOldStorage = createOldStorageMock('LOCAL_STORAGE', oldLocalStorageData)
    ;(getOldVersionStorages as ReturnType<typeof vi.fn>).mockReturnValueOnce([mockOldStorage])

    const migration = await import('./migration')
    await migration._migrateStorageForTest()

    // Mobile should copy all keys from localStorage to SQLite
    // Migration condition: oldConfigVersion (5) > configVersion (0) ✓ && storage types differ ✓
    expect(mockOldStorage.getAllStoreKeys).toHaveBeenCalled()

    // All data should be migrated to SQLite
    expect(sqliteData[StorageKey.ConfigVersion]).toBeDefined()
    expect(sqliteData[StorageKey.Settings]).toBeDefined()
    expect(sqliteData[StorageKey.Configs]).toBeDefined()
    expect(sqliteData[StorageKey.ChatSessionsList]).toBeDefined()
    expect(sqliteData['session:1']).toBeDefined()
    expect(sqliteData['session:2']).toBeDefined()

    // Should mark as migrated in old storage
    expect(mockOldStorage.setStoreValue).toHaveBeenCalledWith(
      'migrated',
      expect.stringContaining('migrated from LOCAL_STORAGE to MOBILE_SQLITE')
    )

    expect(initData).not.toHaveBeenCalled()
  })

  it('should migrate from IndexedDB (v1.16.1) to SQLite (v1.17.0) on mobile', async () => {
    const { getOldVersionStorages } = await import('../platform/storages')
    const { initData } = await import('@/setup/init_data')

    // Setup: Switch to Mobile platform
    currentPlatform = mobilePlatform

    // Setup: Mobile v1.16.1 used IndexedDB with config version 12
    // This simulates a user upgrading from v1.16.1 to v1.17.0
    const oldIndexedDBData: StorageData = {
      [StorageKey.ConfigVersion]: JSON.stringify(12),
      [StorageKey.Settings]: JSON.stringify({ theme: 'light', language: 'zh' }),
      [StorageKey.Configs]: JSON.stringify({ apiKey: 'indexeddb-key' }),
      [StorageKey.ChatSessionsList]: JSON.stringify([{ id: 'a' }, { id: 'b' }]),
      'session:a': JSON.stringify({ id: 'a', name: 'Session A', messages: [] }),
      'session:b': JSON.stringify({ id: 'b', name: 'Session B', messages: [] }),
    }

    const mockOldStorage = createOldStorageMock('INDEXEDDB', oldIndexedDBData)
    ;(getOldVersionStorages as ReturnType<typeof vi.fn>).mockReturnValueOnce([mockOldStorage])

    const migration = await import('./migration')
    await migration._migrateStorageForTest()

    // Mobile should copy all keys from IndexedDB to SQLite
    expect(mockOldStorage.getAllStoreKeys).toHaveBeenCalled()

    // All data should be migrated to SQLite
    expect(sqliteData[StorageKey.ConfigVersion]).toBeDefined()
    expect(sqliteData[StorageKey.Settings]).toBeDefined()
    expect(sqliteData[StorageKey.Configs]).toBeDefined()
    expect(sqliteData[StorageKey.ChatSessionsList]).toBeDefined()
    expect(sqliteData['session:a']).toBeDefined()
    expect(sqliteData['session:b']).toBeDefined()

    // Should mark as migrated
    expect(mockOldStorage.setStoreValue).toHaveBeenCalledWith(
      'migrated',
      expect.stringContaining('migrated from INDEXEDDB to MOBILE_SQLITE')
    )

    expect(initData).not.toHaveBeenCalled()
  })

  it('should handle multiple old storages and pick the newest one (mobile: localStorage v5 + IndexedDB v12)', async () => {
    const { getOldVersionStorages } = await import('../platform/storages')
    const { initData } = await import('@/setup/init_data')

    // Setup: Switch to Mobile platform
    currentPlatform = mobilePlatform

    // Scenario: User upgraded from v1.9.8 → v1.16.1 → v1.17.0
    // This left data in both localStorage (version 5) and IndexedDB (version 12)
    // Migration should pick IndexedDB (version 12) as it's newer

    const oldLocalStorageData: StorageData = {
      [StorageKey.ConfigVersion]: JSON.stringify(5),
      [StorageKey.Settings]: JSON.stringify({ theme: 'dark' }),
      [StorageKey.ChatSessionsList]: JSON.stringify([{ id: 'old1' }]),
      'session:old1': JSON.stringify({ id: 'old1', name: 'Old Session', messages: [] }),
    }

    const oldIndexedDBData: StorageData = {
      [StorageKey.ConfigVersion]: JSON.stringify(12),
      [StorageKey.Settings]: JSON.stringify({ theme: 'light' }),
      [StorageKey.ChatSessionsList]: JSON.stringify([{ id: 'new1' }, { id: 'new2' }]),
      'session:new1': JSON.stringify({ id: 'new1', name: 'New Session 1', messages: [] }),
      'session:new2': JSON.stringify({ id: 'new2', name: 'New Session 2', messages: [] }),
    }

    const mockLocalStorage = createOldStorageMock('LOCAL_STORAGE', oldLocalStorageData)
    const mockIndexedDBStorage = createOldStorageMock('INDEXEDDB', oldIndexedDBData)

    // Return both storages - migration should pick the newest (IndexedDB v12)

    ;(getOldVersionStorages as ReturnType<typeof vi.fn>).mockReturnValueOnce([mockLocalStorage, mockIndexedDBStorage])

    const migration = await import('./migration')
    await migration._migrateStorageForTest()

    // Should migrate from IndexedDB (newer) not localStorage
    expect(mockIndexedDBStorage.getAllStoreKeys).toHaveBeenCalled()
    expect(mockLocalStorage.getAllStoreKeys).not.toHaveBeenCalled()

    // Data from IndexedDB should be in SQLite
    const sessionListData = JSON.parse(sqliteData[StorageKey.ChatSessionsList] || '[]')
    expect(sessionListData).toEqual([{ id: 'new1' }, { id: 'new2' }])
    expect(sqliteData['session:new1']).toBeDefined()
    expect(sqliteData['session:new2']).toBeDefined()

    // Old data from localStorage should NOT be migrated
    expect(sqliteData['session:old1']).toBeUndefined()

    // Should mark IndexedDB as migrated
    expect(mockIndexedDBStorage.setStoreValue).toHaveBeenCalledWith(
      'migrated',
      expect.stringContaining('migrated from INDEXEDDB to MOBILE_SQLITE')
    )

    // localStorage should NOT be marked as migrated
    expect(mockLocalStorage.setStoreValue).not.toHaveBeenCalled()

    expect(initData).not.toHaveBeenCalled()
  })

  it('should migrate from desktop file (v1.9.10) to IndexedDB (v1.16.1) and preserve settings/configs in file', async () => {
    const { getOldVersionStorages } = await import('../platform/storages')
    const { initData } = await import('@/setup/init_data')

    // Desktop platform already set in beforeEach

    // Setup: Desktop v1.9.10 used single config.json (version 5)
    // User upgrades to v1.16.1 which uses IndexedDB
    // Note: v1.17.0 uses hybrid (IndexedDB for sessions, file for settings/configs)
    const oldFileData: StorageData = {
      [StorageKey.ConfigVersion]: JSON.stringify(5),
      [StorageKey.Settings]: JSON.stringify({ theme: 'dark', fontSize: 14 }),
      [StorageKey.Configs]: JSON.stringify({ apiKey: 'desktop-key' }),
      [StorageKey.ChatSessionsList]: JSON.stringify([{ id: 'desk1' }]),
      'session:desk1': JSON.stringify({ id: 'desk1', name: 'Desktop Session', messages: [] }),
      'custom-key': JSON.stringify({ custom: 'data' }),
    }

    const mockOldStorage = createOldStorageMock('DESKTOP_FILE', oldFileData)
    ;(getOldVersionStorages as ReturnType<typeof vi.fn>).mockReturnValueOnce([mockOldStorage])

    const migration = await import('./migration')
    await migration._migrateStorageForTest()

    // Should get all values from old storage
    expect(mockOldStorage.getAllStoreValues).toHaveBeenCalled()

    // Session data should be migrated to IndexedDB
    expect(localforageData[StorageKey.ChatSessionsList]).toBeDefined()
    expect(localforageData['session:desk1']).toBeDefined()
    expect(localforageData['custom-key']).toBeDefined()

    // Settings, configs, configVersion should NOT be in IndexedDB (they stay in file)
    expect(localforageData[StorageKey.Settings]).toBeUndefined()
    expect(localforageData[StorageKey.Configs]).toBeUndefined()
    expect(localforageData[StorageKey.ConfigVersion]).toBeUndefined()

    // Session keys should be deleted from old file storage
    const deletedKeys = mockOldStorage.delStoreValue.mock.calls.map((call: unknown[]) => call[0])
    expect(deletedKeys).toContain(StorageKey.ChatSessionsList)
    expect(deletedKeys).toContain('session:desk1')
    expect(deletedKeys).toContain('custom-key')

    // Settings/configs/configVersion should NOT be deleted (stay in file)
    expect(deletedKeys).not.toContain(StorageKey.Settings)
    expect(deletedKeys).not.toContain(StorageKey.Configs)
    expect(deletedKeys).not.toContain(StorageKey.ConfigVersion)

    expect(initData).not.toHaveBeenCalled()
  })

  it('should handle mobile migration with SQLite v7 data (v1.9.11 to v1.17.0)', async () => {
    const { getOldVersionStorages } = await import('../platform/storages')
    const { initData } = await import('@/setup/init_data')

    // Setup: Switch to Mobile platform
    currentPlatform = mobilePlatform

    // Setup: Mobile v1.9.11 used SQLite with config version 7
    // User stayed on v1.9.11 and never upgraded to v1.16.1
    // Now upgrading directly to v1.17.0 (which also uses SQLite)
    //
    // IMPORTANT: Since both old and current storage are MOBILE_SQLITE,
    // they share the same data source (sqliteData). So when old storage
    // has data, current storage already has access to it.
    const oldSQLiteData: StorageData = {
      [StorageKey.ConfigVersion]: JSON.stringify(7),
      [StorageKey.Settings]: JSON.stringify({ theme: 'dark' }),
      [StorageKey.Configs]: JSON.stringify({ apiKey: 'sqlite-v7-key' }),
      [StorageKey.ChatSessionsList]: JSON.stringify([{ id: 'sql1' }]),
      'session:sql1': JSON.stringify({ id: 'sql1', name: 'SQLite Session', messages: [] }),
    }

    const mockOldStorage = createOldStorageMock('MOBILE_SQLITE', oldSQLiteData)
    ;(getOldVersionStorages as ReturnType<typeof vi.fn>).mockReturnValueOnce([mockOldStorage])

    const migration = await import('./migration')
    await migration._migrateStorageForTest()

    // Current storage reads configVersion from sqliteData, which is 7 (not 0)
    // Since configVersion (7) < CurrentVersion (13), it checks for migration
    // But since old and current storage are same type, no migration occurs
    // And since configVersion is NOT 0, initData() is also not called

    // Only configVersion should be checked from old storage
    expect(mockOldStorage.getStoreValue).toHaveBeenCalledWith(StorageKey.ConfigVersion)
    expect(mockOldStorage.getAllStoreKeys).not.toHaveBeenCalled()
    expect(mockOldStorage.setStoreValue).not.toHaveBeenCalled()

    // No initData() because configVersion is 7, not 0
    expect(initData).not.toHaveBeenCalled()

    // Data is already accessible through sqliteData
    expect(sqliteData[StorageKey.ConfigVersion]).toBe(JSON.stringify(7))
    expect(sqliteData[StorageKey.ChatSessionsList]).toBeDefined()
  })

  it('should NOT migrate from file storage when desktop configVersion >= 12 (prevent duplicate migration bug)', async () => {
    const { getOldVersionStorages } = await import('../platform/storages')
    const { initData } = await import('@/setup/init_data')

    // Desktop platform already set in beforeEach

    // Setup: This tests a bug fix in the current branch
    // BUG on release branch: Every time configVersion upgrades (e.g., 12→13),
    // it would re-migrate from file storage to IndexedDB even though migration
    // already happened at v1.16.1 (configVersion 11→12)
    //
    // FIX: Desktop should NOT migrate from file storage if configVersion >= 12
    // because v1.16.1 already migrated sessions to IndexedDB
    //
    // Scenario: Desktop v1.16.1 user (configVersion=12) upgrades to v1.17.0 (configVersion=13)
    // File storage still has old session data from pre-v1.16.1 that wasn't cleaned up
    // Current configVersion in file: 12 (already migrated)
    // Should NOT re-migrate the old session data

    // File storage (current storage for desktop):
    // - configVersion=12 (from v1.16.1, already migrated)
    // - settings and configs (current values)
    // - Old session data from v1.9.x (leftover, not cleaned up during v1.16.1 migration)
    const oldFileData: StorageData = {
      [StorageKey.ConfigVersion]: JSON.stringify(12),
      [StorageKey.Settings]: JSON.stringify({ theme: 'light', fontSize: 16 }),
      [StorageKey.Configs]: JSON.stringify({ apiKey: 'current-key' }),
      // These are leftover session data from pre-v1.16.1 that should be ignored
      [StorageKey.ChatSessionsList]: JSON.stringify([{ id: 'old-session' }]),
      'session:old-session': JSON.stringify({ id: 'old-session', name: 'Old Session', messages: [] }),
    }

    // Current IndexedDB storage (v1.16.1): Already has migrated sessions
    localforageData[StorageKey.ChatSessionsList] = JSON.stringify([{ id: 'current-session' }])
    localforageData['session:current-session'] = JSON.stringify({
      id: 'current-session',
      name: 'Current Session',
      messages: [],
    })

    const mockOldFileStorage = createOldStorageMock('DESKTOP_FILE', oldFileData)
    ;(getOldVersionStorages as ReturnType<typeof vi.fn>).mockReturnValueOnce([mockOldFileStorage])

    const migration = await import('./migration')
    await migration._migrateStorageForTest()

    // Should NOT migrate because:
    // 1. Current configVersion (12) >= 12 means already migrated to IndexedDB
    // 2. File storage is same type as old storage (both DESKTOP_FILE)
    expect(mockOldFileStorage.getAllStoreValues).not.toHaveBeenCalled()
    expect(mockOldFileStorage.delStoreValue).not.toHaveBeenCalled()
    expect(mockOldFileStorage.setStoreValue).not.toHaveBeenCalled()

    // Current IndexedDB data should remain unchanged (not overwritten by old data)
    const currentSessionList = JSON.parse(localforageData[StorageKey.ChatSessionsList] || '[]')
    expect(currentSessionList).toEqual([{ id: 'current-session' }])
    expect(localforageData['session:current-session']).toBeDefined()
    expect(localforageData['session:old-session']).toBeUndefined()

    expect(initData).not.toHaveBeenCalled()
  })
})
