import { createHash } from 'node:crypto'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { exportBackupV3 } from '../backup-v3/archive'
import type { BackupBusinessRecord, BackupExportSource, BackupSelection, BackupWorkspace } from '../backup-v3/types'
import type { ByteSink } from '../io'
import { exportBackup } from './index'
import type { BackupExportOptions, LegacyBackupManifest } from './types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
function combine(parts: Uint8Array[]) {
  const value = new Uint8Array(parts.reduce((sum, bytes) => sum + bytes.length, 0))
  let offset = 0
  for (const bytes of parts) {
    value.set(bytes, offset)
    offset += bytes.length
  }
  return value
}
function sink() {
  const parts: Uint8Array[] = []
  const state = { closed: false, aborted: false }
  const output: ByteSink = {
    write: async (bytes) => {
      parts.push(bytes.slice())
    },
    close: async () => {
      state.closed = true
    },
    abort: async () => {
      state.aborted = true
      parts.length = 0
    },
  }
  return { output, state, bytes: () => combine(parts) }
}
class Workspace implements BackupWorkspace {
  files = new Map<string, Uint8Array>()
  indexes = new Map<string, Map<string, string>>()
  disposed = false
  sourceCount = 0
  sourceCloseCount = 0
  async createFile(name: string) {
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error('Workspace filenames must be flat')
    const file = sink()
    return {
      ...file.output,
      close: async () => {
        await file.output.close()
        this.files.set(name, file.bytes())
      },
    }
  }
  async openFile(name: string) {
    const bytes = this.files.get(name)
    if (!bytes) throw new Error('Missing workspace file')
    this.sourceCount++
    return {
      size: bytes.length,
      readBytes: async (offset: number, length: number) => bytes.slice(offset, offset + length),
      close: async () => {
        this.sourceCloseCount++
      },
    }
  }
  async put(table: string, key: string, value: string) {
    const index = this.indexes.get(table) ?? new Map<string, string>()
    this.indexes.set(table, index)
    if (index.has(key)) return false
    index.set(key, value)
    return true
  }
  async get(table: string, key: string) {
    return this.indexes.get(table)?.get(key) ?? null
  }
  async *entries(table: string) {
    for (const [key, value] of this.indexes.get(table) ?? []) yield { key, value }
  }
  async dispose() {
    this.disposed = true
    this.files.clear()
    this.indexes.clear()
  }
}
function conversation(id: string): BackupBusinessRecord[] {
  return [
    { type: 'session', session: { id, name: `对话 ${id}`, activeThreadId: id }, meta: { sortOrder: 4, createdAt: 2 } },
    {
      type: 'thread',
      thread: {
        sessionId: id,
        threadId: id,
        threadOrder: -1,
        name: null,
        createdAt: 2,
        rootMessageId: `${id}-message`,
        compactionPoints: [],
      },
    },
    {
      type: 'message',
      message: {
        sessionId: id,
        threadId: id,
        messageId: `${id}-message`,
        parentMessageId: null,
        activeChildId: null,
        siblingOrder: 0,
        kind: 'message',
        branchId: null,
        createdAt: 2,
        updatedAt: 2,
        message: {
          id: `${id}-message`,
          role: 'user',
          contentParts: [
            { type: 'text', text: '你好 😀\ntext' },
            { type: 'image', storageKey: 'picture:shared' },
          ],
          files: [{ id: 'file', name: 'notes.txt', fileType: 'text/plain', storageKey: 'file:text' }],
        },
      },
    },
  ]
}
function setup(overrides: Partial<BackupExportOptions> = {}) {
  const workspace = new Workspace()
  const archive = sink()
  const opened: string[] = []
  const closed: string[] = []
  const selected: BackupSelection[] = []
  const resources = new Map<string, { bytes: Uint8Array; mimeType: string; contentType: 'text' | 'binary' }>([
    [
      'picture:shared',
      { bytes: Uint8Array.of(137, 80, 78, 71, 0, 255), mimeType: 'image/png', contentType: 'binary' as const },
    ],
    ['file:text', { bytes: encoder.encode('附件内容 😀'), mimeType: 'text/plain', contentType: 'text' as const }],
  ])
  const source: BackupExportSource = {
    async *records(selection) {
      selected.push(selection)
      for (const id of selection.sessions ? (selection.sessionIds ?? ['A', 'B']) : []) yield* conversation(id)
    },
    async openResource(key) {
      const resource = resources.get(key)
      if (!resource) return null
      opened.push(key)
      return {
        ...resource,
        source: {
          size: resource.bytes.length,
          readBytes: async (offset: number, length: number) => resource.bytes.slice(offset, offset + length),
          close: async () => {
            closed.push(key)
          },
        },
      }
    },
  }
  const options: BackupExportOptions = {
    archiveId: 'archive',
    createdAt: '2026-10-23T00:00:00.000Z',
    producer: 'test',
    application: { version: '1.24.0', platform: 'test' },
    format: 'v2',
    selection: { sessions: true, settings: false, copilots: false, credentials: false },
    workspace,
    output: archive.output,
    source,
    ...overrides,
  }
  return { options, workspace, archive, opened, closed, selected, resources }
}
function readArchive(bytes: Uint8Array) {
  const entries = unzipSync(bytes)
  const manifest = JSON.parse(decoder.decode(entries['manifest.json'])) as LegacyBackupManifest
  return { entries, manifest }
}

describe('V2 compatibility archive export', () => {
  it('writes exactly the manifest entries with UTF-8 sizes, SHA-256 and shared resource ownership', async () => {
    const test = setup()
    const result = await exportBackup(test.options)
    const { entries, manifest } = readArchive(test.archive.bytes())
    expect(manifest).toEqual(result.manifest)
    expect(manifest).toMatchObject({
      format: 'chatbox-backup',
      formatVersion: 2,
      application: { name: 'Chatbox', version: '1.24.0', platform: 'test' },
      exportItems: ['conversations'],
    })
    const descriptors = [...manifest.sessions, ...manifest.resources, ...Object.values(manifest.data)]
    expect(Object.keys(entries).sort()).toEqual(['manifest.json', ...descriptors.map((entry) => entry.path)].sort())
    for (const descriptor of descriptors) {
      expect(descriptor.size).toBe(entries[descriptor.path].length)
      expect(descriptor.checksum).toEqual({
        algorithm: 'sha256',
        value: createHash('sha256').update(entries[descriptor.path]).digest('hex'),
      })
    }
    expect(manifest.stats).toEqual({ sessionCount: 2, resourceCount: 2, deduplicatedResourceCount: 0, warningCount: 0 })
    for (const resource of manifest.resources) {
      expect(resource.sessionIds).toEqual(['A', 'B'])
      expect(resource.scope).toBe('shared')
      expect(manifest.sessions.every((session) => session.resourceIds.includes(resource.id))).toBe(true)
      const original = test.resources.get(resource.originalStorageKeys[0])!
      expect(entries[resource.path]).toEqual(original.bytes)
      expect(resource.encoding).toBe(original.contentType === 'binary' ? 'data-url-base64' : 'utf8')
    }
    expect(manifest.sessions[0].meta).toMatchObject({ id: 'A', name: '对话 A', sortOrder: 4, createdAt: 2 })
    expect([...test.opened].sort()).toEqual(['file:text', 'picture:shared'])
    expect(test.closed).toEqual(test.opened)
    expect(test.workspace.sourceCloseCount).toBe(test.workspace.sourceCount)
    expect(test.workspace.disposed).toBe(true)
    expect(test.archive.state).toEqual({ closed: true, aborted: false })
  })

  it('passes partial selection to the source and includes only selected conversations', async () => {
    const selection: BackupSelection = {
      sessions: true,
      sessionIds: ['B'],
      settings: false,
      copilots: false,
      credentials: false,
    }
    const test = setup({ selection })
    await exportBackup(test.options)
    const { entries, manifest } = readArchive(test.archive.bytes())
    expect(test.selected).toEqual([selection])
    expect(manifest.sessions.map((session) => session.id)).toEqual(['B'])
    expect(entries['sessions/A/session.json']).toBeUndefined()
    expect(
      manifest.resources.every((resource) => resource.scope === 'session' && resource.sessionIds.join() === 'B')
    ).toBe(true)
  })

  it('exports the selected global configuration categories and their global resources', async () => {
    const test = setup({ selection: { sessions: false, settings: true, copilots: true, credentials: true } })
    const settings = { userAvatarKey: 'picture:shared', providers: { custom: { apiKey: 'synthetic-test-value' } } }
    test.options.source = {
      ...test.options.source,
      async *records() {
        yield { type: 'global', category: 'settings', id: 'settings', value: settings }
        yield {
          type: 'global',
          category: 'copilot',
          id: 'copilot',
          value: { id: 'copilot', name: 'Assistant', prompt: 'Hello' },
        }
        yield { type: 'global', category: 'soul', id: 'agent-soul', value: { content: 'Persona', updatedAt: 1 } }
      },
    }
    await exportBackup(test.options)
    const { entries, manifest } = readArchive(test.archive.bytes())
    expect(JSON.parse(decoder.decode(entries['settings.json']))).toEqual(settings)
    expect(JSON.parse(decoder.decode(entries['copilots.json']))).toEqual([
      { id: 'copilot', name: 'Assistant', prompt: 'Hello' },
    ])
    expect(JSON.parse(decoder.decode(entries['session-settings.json']))).toMatchObject({
      'agent-soul': { content: 'Persona', updatedAt: 1 },
      'agent-memories': [],
      'copilot-memories': {},
    })
    expect(manifest.exportItems).toEqual(['setting', 'key', 'copilot'])
    expect(manifest.sessions).toEqual([])
    expect(manifest.resources[0]).toMatchObject({
      scope: 'global',
      sessionIds: [],
      originalStorageKeys: ['picture:shared'],
    })
  })

  it('keeps the unspecified format identical to the V3 exporter', async () => {
    const defaults = setup({ format: undefined })
    const explicit = setup({ format: 'v3' })
    const baseline = setup()
    const first = await exportBackup(defaults.options)
    await exportBackup(explicit.options)
    await exportBackupV3(baseline.options)
    expect(first.manifest?.formatVersion).toBe(3)
    const files = (bytes: Uint8Array) =>
      Object.fromEntries(Object.entries(unzipSync(bytes)).map(([key, value]) => [key, [...value]]))
    expect(files(defaults.archive.bytes())).toEqual(files(baseline.archive.bytes()))
    expect(files(explicit.archive.bytes())).toEqual(files(baseline.archive.bytes()))
  })

  it.each(['missing', 'unselected'] as const)('rejects a source with %s selected conversations', async (problem) => {
    const test = setup({
      selection: { sessions: true, sessionIds: ['A'], settings: false, copilots: false, credentials: false },
    })
    test.options.source = {
      ...test.options.source,
      async *records() {
        if (problem === 'unselected') yield* conversation('B')
      },
    }
    await expect(exportBackup(test.options)).rejects.toThrow(/selected conversation/)
    expect(test.archive.state.aborted).toBe(true)
    expect(test.workspace.disposed).toBe(true)
  })

  it('skips a missing managed attachment and reports it', async () => {
    const test = setup()
    test.resources.delete('picture:shared')
    const result = await exportBackup(test.options)
    expect(result.missingResources).toBe(1)
    const { entries, manifest } = readArchive(test.archive.bytes())
    expect(manifest.resources.map((resource) => resource.originalStorageKeys)).toEqual([['file:text']])
    expect(manifest.stats.resourceCount).toBe(1)
    expect(result.complete.entryCount).toBe(Object.keys(entries).length)
    expect(test.archive.state).toEqual({ closed: true, aborted: false })
    expect(test.workspace.disposed).toBe(true)
  })

  it('fails when opening an existing attachment fails and disposes temporary files', async () => {
    const test = setup()
    test.options.source.openResource = async () => {
      throw new Error('Resource read failed')
    }
    await expect(exportBackup(test.options)).rejects.toThrow('Resource read failed')
    expect(test.archive.state).toEqual({ closed: false, aborted: true })
    expect(test.workspace.disposed).toBe(true)
  })

  it('cancels record consumption and cleans unfinished output', async () => {
    const controller = new AbortController()
    const test = setup({ signal: controller.signal })
    test.options.source = {
      ...test.options.source,
      async *records() {
        yield conversation('A')[0]
        controller.abort()
        yield conversation('A')[1]
      },
    }
    await expect(exportBackup(test.options)).rejects.toMatchObject({ name: 'AbortError' })
    expect(test.archive.state.aborted).toBe(true)
    expect(test.workspace.disposed).toBe(true)
  })

  it('closes opened sources and cleans the workspace after output failure', async () => {
    const test = setup()
    test.options.output = {
      ...test.options.output,
      write: async () => {
        throw new Error('Disk full')
      },
    }
    await expect(exportBackup(test.options)).rejects.toThrow('Disk full')
    expect(test.archive.state.aborted).toBe(true)
    expect(test.workspace.disposed).toBe(true)
    expect(test.workspace.sourceCloseCount).toBe(test.workspace.sourceCount)
    expect(test.closed).toEqual(test.opened)
  })

  it('reports pending cleanup after a complete archive is generated', async () => {
    const test = setup()
    test.workspace.dispose = async () => {
      throw new Error('Cleanup unavailable')
    }
    const result = await exportBackup(test.options)
    expect(result.cleanupPending).toBe(true)
    expect(test.archive.state.closed).toBe(true)
    expect(readArchive(test.archive.bytes()).manifest.formatVersion).toBe(2)
  })

  it('preserves the output error when temporary cleanup also fails', async () => {
    const test = setup()
    const error = new Error('Disk full')
    test.options.output.write = async () => {
      throw error
    }
    test.workspace.dispose = async () => {
      throw new Error('Cleanup unavailable')
    }
    await expect(exportBackup(test.options)).rejects.toMatchObject({ errors: [error, expect.any(AggregateError)] })
    expect(test.archive.state.aborted).toBe(true)
  })

  it.each([
    { maxRecordBytes: 64 },
    { maxDataBytes: 128 },
    { maxResourceBytes: 1 },
    { maxUncompressedBytes: 1 },
    { maxEntries: 1 },
    { maxArchiveBytes: 1 },
    { maxGlobalBytes: 1 },
  ])('enforces actual byte and entry budgets %j', async (limits) => {
    const test = setup({ limits })
    await expect(exportBackup(test.options)).rejects.toThrow(/budget|limit|large|entries|capacity/)
    expect(test.workspace.disposed).toBe(true)
    expect(test.archive.state.aborted).toBe(true)
  })
})
