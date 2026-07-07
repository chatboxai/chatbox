import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Storage Migration History (desktop-only since the mobile/web build paths were removed):
 *
 * v1.9.8 - v1.9.10 (config version 0-5)
 *   - Desktop: Single config.json file (IPC) - all data in one file
 *
 * v1.12.0 (config version 7-8)
 *   - Data format: sessions → session-list migration
 *
 * v1.13.1 (config version 9-10)
 *   - Data format: Storage structure refactoring
 *
 * v1.16.1 (config version 11-12)
 *   - Desktop: Split storage - sessions in IndexedDB, configs/settings/configVersion stay in IPC file
 *
 * v1.17.0 (config version 12-13) [CURRENT]
 *   - Desktop: No change from v1.16.1 - sessions in IndexedDB, configs/settings/configVersion in IPC file
 *
 * Key Points:
 *   - Desktop has ALWAYS kept configVersion/settings/configs in file storage (never in IndexedDB)
 *   - Desktop only moved session data to IndexedDB in v1.16.1
 *
 * Migration Logic:
 *   - Detect old storage locations (IPC file storage)
 *   - Copy data to new storage only if storage type changed
 *   - Clear old storage after successful migration
 *   - Skip migration if configVersion >= 12 (sessions already migrated to IndexedDB)
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

// Helper function to create old storage mock based on storage type
// This ensures old storage mocks match the actual storage implementations
function createOldStorageMock(type: 'DESKTOP_FILE' | 'INDEXEDDB', data: StorageData) {
  // For DESKTOP_FILE: Data is stored in a single config.json file accessed via IPC
  // For INDEXEDDB: Data is stored in browser IndexedDB via localforage

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
  }
  // IndexedDB storage: data stored via localforage (shared with current storage)
  // Populate localforageData with initial data
  for (const [key, value] of Object.entries(data)) {
    localforageData[key] = value
  }
  return createStorageMock(localforageData)
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
  electronAPI: {
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

// Current platform instance - will be initialized after mocks
let currentPlatform: Platform

// Mock @/platform to return our platform instance
vi.mock('@/platform', () => ({
  get default() {
    return currentPlatform
  },
}))

// Mock localforage (both the default instance used by migrate_2_to_3 and createInstance)
vi.mock('localforage', () => ({
  default: {
    createInstance: vi.fn(() => mockLocalforageInstance),
    getItem: vi.fn((key: string) => Promise.resolve(localforageData[key] ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      localforageData[key] = value
      return Promise.resolve(undefined)
    }),
    removeItem: vi.fn((key: string) => {
      delete localforageData[key]
      return Promise.resolve(undefined)
    }),
    keys: vi.fn(() => Promise.resolve(Object.keys(localforageData))),
  },
}))

// Mock only external dependencies, not storage or platform
vi.mock('@/setup/init_data', () => ({
  initData: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./migration-legacy-storage', () => ({
  getOldVersionStorages: vi.fn(() => []),
  DesktopFileStorage: vi.fn(),
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

vi.mock('@shared/sentry-shim', () => ({
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
  // Initialize platform instance after all mocks are set up
  beforeAll(async () => {
    const { default: DesktopPlatformClass } = await import('@/platform/desktop_platform')

    currentPlatform = new DesktopPlatformClass(window.electronAPI)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    // Clear all storage data before each test
    localforageData = {}
    ipcFileData = {}
  })

  it('should skip migration when config version is already current', async () => {
    const { initData } = await import('@/setup/init_data')

    // Setup: Desktop v1.17.0 - configVersion = 14 (current) in IPC file storage
    ipcFileData[StorageKey.ConfigVersion] = JSON.stringify(14)

    const migration = await import('@/stores/migration')
    await migration._migrateStorageForTest()

    // Should not initialize data or set version when already at current version
    expect(initData).not.toHaveBeenCalled()
    // configVersion should remain 14
    expect(ipcFileData[StorageKey.ConfigVersion]).toBe(JSON.stringify(14))
  })

  it('should initialize data on first run (configVersion = 0, no old storage)', async () => {
    const { getOldVersionStorages } = await import('./migration-legacy-storage')
    const { initData } = await import('@/setup/init_data')

    // Setup: First run - no data in any storage
    // All storage containers are empty

    // No old storage with data

    ;(getOldVersionStorages as ReturnType<typeof vi.fn>).mockReturnValueOnce([])

    const migration = await import('@/stores/migration')
    await migration._migrateStorageForTest()

    // Should set current version (15) to IPC file storage (Desktop platform)
    expect(ipcFileData[StorageKey.ConfigVersion]).toBe(JSON.stringify(15))
    expect(initData).toHaveBeenCalled()
  })

  it('should not migrate when old storage type matches current storage type', async () => {
    const { getOldVersionStorages } = await import('./migration-legacy-storage')
    const { initData } = await import('@/setup/init_data')

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

    const migration = await import('@/stores/migration')
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
    const { getOldVersionStorages } = await import('./migration-legacy-storage')
    const { initData } = await import('@/setup/init_data')

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

    const migration = await import('@/stores/migration')
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

  it('should migrate from desktop file (v1.9.10) to IndexedDB (v1.16.1) and preserve settings/configs in file', async () => {
    const { getOldVersionStorages } = await import('./migration-legacy-storage')
    const { initData } = await import('@/setup/init_data')

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

    const migration = await import('@/stores/migration')
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

  it('should NOT migrate from file storage when desktop configVersion >= 12 (prevent duplicate migration bug)', async () => {
    const { getOldVersionStorages } = await import('./migration-legacy-storage')
    const { initData } = await import('@/setup/init_data')

    // Setup: This tests a bug fix in the current branch
    // BUG on release branch: Every time configVersion upgrades (e.g., 12→13),
    // it would re-migrate from file storage to IndexedDB even though migration
    // already happened at v1.16.1 (configVersion 11→12)
    //
    // FIX: Desktop should NOT migrate from file storage if configVersion >= 12
    // because v1.16.1 already migrated sessions to IndexedDB
    //
    // Scenario: Desktop v1.16.1 user (configVersion=12) upgrades to v1.17.0 (configVersion=14)
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

    const migration = await import('@/stores/migration')
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
