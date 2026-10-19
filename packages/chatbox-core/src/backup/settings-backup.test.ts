import type { SessionMetaRecord, Settings } from '@shared/types'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { BACKUP_MANIFEST_PATH, BACKUP_SETTINGS_PATH } from './archive-layout'
import { exportBackupArchiveWithRows as exportBackupArchive } from './export.test-support'
import { normalizeBackupExportItems, updateBackupExportItemSelection } from './export-items'
import { BackupStorageKey } from './storage-keys'
import {
  type BackupExportItem,
  type BackupManifest,
  BackupManifestSchema,
  type BackupMetaStorage,
  type BackupStorage,
} from './types'

class MemoryStorage implements BackupStorage {
  readonly values = new Map<string, unknown>()
  readonly blobs = new Map<string, string>()

  getAllKeys(): Promise<string[]> {
    return Promise.resolve(Array.from(this.values.keys()))
  }

  getItem<T>(key: string, initialValue: T): Promise<T> {
    return Promise.resolve((this.values.has(key) ? this.values.get(key) : initialValue) as T)
  }

  setItemNow<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value)
    return Promise.resolve()
  }

  removeItem(key: string): Promise<void> {
    this.values.delete(key)
    return Promise.resolve()
  }

  getBlob(key: string): Promise<string | null> {
    return Promise.resolve(this.blobs.get(key) ?? null)
  }

  setBlob(key: string, value: string): Promise<void> {
    this.blobs.set(key, value)
    return Promise.resolve()
  }

  delBlob(key: string): Promise<void> {
    this.blobs.delete(key)
    return Promise.resolve()
  }
}

class EmptyMetaStorage implements BackupMetaStorage {
  getAllIncludingHidden(): Promise<SessionMetaRecord[]> {
    return Promise.resolve([])
  }

  getById(): Promise<SessionMetaRecord | null> {
    return Promise.resolve(null)
  }

  create(): Promise<void> {
    return Promise.resolve()
  }

  update(): Promise<SessionMetaRecord | null> {
    return Promise.resolve(null)
  }

  delete(): Promise<void> {
    return Promise.resolve()
  }
}

function combine(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function importSettingsWithReleasedV2Semantics(bytes: Uint8Array): Record<string, unknown> | undefined {
  const entries = unzipSync(bytes)
  const manifestEntry = entries[BACKUP_MANIFEST_PATH]
  if (!manifestEntry) throw new Error('Backup manifest is missing')
  const manifest = BackupManifestSchema.parse(JSON.parse(new TextDecoder().decode(manifestEntry)))
  if (!manifest.data.settings) return undefined
  const settingsEntry = entries[manifest.data.settings.path]
  if (!settingsEntry) throw new Error('Backup settings entry is missing')
  return JSON.parse(new TextDecoder().decode(settingsEntry)) as Record<string, unknown>
}

async function exportSettingsArchive(
  settings: Settings | null,
  exportItems: BackupExportItem[]
): Promise<{ bytes: Uint8Array; manifest: BackupManifest; settingsPayload?: Record<string, unknown> }> {
  const storage = new MemoryStorage()
  if (settings) storage.values.set(BackupStorageKey.Settings, settings)
  const chunks: Uint8Array[] = []
  await exportBackupArchive({
    exportItems,
    includeKeys: exportItems.includes('key'),
    exportedAt: new Date('2026-08-31T00:00:00.000Z'),
    storage,
    metaStorage: new EmptyMetaStorage(),
    application: { version: 'test', platform: 'test' },
    writeArchive: async (dataCallback) => {
      for await (const chunk of dataCallback()) chunks.push(chunk)
      return { boundedMemory: true }
    },
  })
  const bytes = combine(chunks)
  const entries = unzipSync(bytes)
  const manifestEntry = entries[BACKUP_MANIFEST_PATH]
  if (!manifestEntry) throw new Error('Backup manifest is missing')
  const settingsEntry = entries[BACKUP_SETTINGS_PATH]
  return {
    bytes,
    manifest: JSON.parse(new TextDecoder().decode(manifestEntry)) as BackupManifest,
    settingsPayload: settingsEntry
      ? (JSON.parse(new TextDecoder().decode(settingsEntry)) as Record<string, unknown>)
      : undefined,
  }
}

function sourceSettings(): Settings {
  return {
    language: 'zh-Hans',
    theme: 'dark',
    licenseKey: 'license-secret',
    licenseActivationMethod: 'manual',
    licenseDetail: { token_usage: 1 },
    licenseInstances: { device: 'runtime-instance' },
    providers: {
      openai: {
        apiHost: 'https://source.example.com',
        apiKey: 'provider-secret',
      },
    },
    memoryEnabled: true,
    memoryStateToken: 'source-global',
  } as unknown as Settings
}

describe('settings backup selection', () => {
  it('exports complete settings with credentials when settings and keys are selected', async () => {
    const { settingsPayload } = await exportSettingsArchive(sourceSettings(), ['setting', 'key'])

    expect(settingsPayload).toMatchObject({
      language: 'zh-Hans',
      theme: 'dark',
      licenseKey: 'license-secret',
      licenseActivationMethod: 'manual',
      providers: {
        openai: {
          apiHost: 'https://source.example.com',
          apiKey: 'provider-secret',
        },
      },
    })
    expect(settingsPayload).not.toHaveProperty('licenseDetail')
    expect(settingsPayload).not.toHaveProperty('licenseInstances')
  })

  it('exports complete settings without credentials when only settings are selected', async () => {
    const { settingsPayload } = await exportSettingsArchive(sourceSettings(), ['setting'])

    expect(settingsPayload).toMatchObject({
      language: 'zh-Hans',
      theme: 'dark',
      providers: { openai: { apiHost: 'https://source.example.com' } },
    })
    expect(settingsPayload).not.toHaveProperty('licenseKey')
    expect(settingsPayload).not.toHaveProperty('providers.openai.apiKey')
  })

  it('exports complete v2 settings when credentials are selected', async () => {
    const { bytes, manifest, settingsPayload } = await exportSettingsArchive(sourceSettings(), ['key'])

    expect(manifest.formatVersion).toBe(2)
    expect(manifest.exportItems).toEqual(['setting', 'key'])
    expect(manifest.data.settings).toBeDefined()
    expect(settingsPayload).toMatchObject({
      language: 'zh-Hans',
      theme: 'dark',
      licenseKey: 'license-secret',
      licenseActivationMethod: 'manual',
      providers: {
        openai: {
          apiHost: 'https://source.example.com',
          apiKey: 'provider-secret',
        },
      },
      memoryEnabled: true,
    })
    expect(settingsPayload).not.toHaveProperty('licenseDetail')
    expect(settingsPayload).not.toHaveProperty('licenseInstances')

    expect(importSettingsWithReleasedV2Semantics(bytes)).toMatchObject({
      language: 'zh-Hans',
      theme: 'dark',
      licenseKey: 'license-secret',
      licenseActivationMethod: 'manual',
      memoryEnabled: true,
      providers: {
        openai: {
          apiHost: 'https://source.example.com',
          apiKey: 'provider-secret',
        },
      },
    })
  })

  it('omits the settings entry when neither settings nor keys are selected', async () => {
    const { manifest, settingsPayload } = await exportSettingsArchive(sourceSettings(), [])

    expect(manifest.data.settings).toBeUndefined()
    expect(settingsPayload).toBeUndefined()
  })

  it('does not replace settings when credentials are selected without stored settings', async () => {
    const { manifest, settingsPayload } = await exportSettingsArchive(null, ['key'])

    expect(manifest.exportItems).toEqual(['setting', 'key'])
    expect(manifest.data.settings).toBeUndefined()
    expect(settingsPayload).toBeUndefined()
  })

  it('keeps settings selected while credentials are selected', () => {
    expect(normalizeBackupExportItems(['key', 'copilot'])).toEqual(['setting', 'key', 'copilot'])
    expect(updateBackupExportItemSelection(['conversations'], 'key', true)).toEqual(['setting', 'key', 'conversations'])
    expect(updateBackupExportItemSelection(['setting', 'key', 'conversations'], 'setting', false)).toEqual([
      'conversations',
    ])
    expect(updateBackupExportItemSelection(['setting', 'key'], 'key', false)).toEqual(['setting'])
  })
})
