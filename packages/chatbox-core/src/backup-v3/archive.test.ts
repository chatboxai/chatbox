import { describe, expect, it, vi } from 'vitest'
import { unzipSync, zipSync } from 'fflate'
import type { ByteSink, ClosableByteSource } from '../io'
import { deriveMessageFacts } from '../session/message-facts'
import { exportBackupV3, exportBackupV3Stream, importBackupV3, readBackupV3Manifest } from './archive'
import { getBackupImportPartialResult } from './errors'
import { trackedNodeCodec } from './codec.test-helpers'
import { backupResourcePath, backupSessionPath } from './layout'
import { decodeJsonLines, encodeLine, singleChunk } from './streams'
import type {
  BackupBusinessRecord,
  BackupCodec,
  BackupExportSource,
  BackupImportTarget,
  BackupImportIssueReporter,
  BackupImportSummary,
  BackupRecord,
  BackupResourceRecord,
  BackupSelection,
  BackupLimits,
  BackupImportContext,
  BackupWorkspace,
} from './types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const selection: BackupSelection = { sessions: true, settings: false, copilots: false, credentials: false }
function combine(parts: Uint8Array[]) {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}
function source(bytes: Uint8Array): ClosableByteSource {
  return {
    size: bytes.length,
    readBytes: async (offset, length) => bytes.slice(offset, offset + length),
    close: async () => {},
  }
}
function sink(commit: (bytes: Uint8Array) => void): ByteSink {
  const parts: Uint8Array[] = []
  return {
    write: async (bytes) => {
      parts.push(bytes.slice())
    },
    close: async () => {
      commit(combine(parts))
    },
    abort: async () => {
      parts.length = 0
    },
  }
}
class Workspace implements BackupWorkspace {
  files = new Map<string, Uint8Array>()
  tables = new Map<string, Map<string, string>>()
  disposed = false
  async createFile(name: string) {
    return sink((bytes) => {
      this.files.set(name, bytes)
    })
  }
  async openFile(name: string) {
    const bytes = this.files.get(name)
    if (!bytes) throw new Error('Missing test file')
    return source(bytes)
  }
  async put(table: string, key: string, value: string) {
    let map = this.tables.get(table)
    if (!map) {
      map = new Map()
      this.tables.set(table, map)
    }
    if (map.has(key)) return false
    map.set(key, value)
    return true
  }
  async get(table: string, key: string) {
    return this.tables.get(table)?.get(key) ?? null
  }
  async *entries(table: string) {
    for (const [key, value] of this.tables.get(table) ?? []) yield { key, value }
  }
  async dispose() {
    this.disposed = true
  }
}
function fixture(sessionId = 'A', resourceId = 'resource:共享'): BackupBusinessRecord[] {
  return [
    { type: 'session', session: { id: sessionId, name: '对话', activeThreadId: `${sessionId}-t` } },
    {
      type: 'thread',
      thread: {
        sessionId,
        threadId: `${sessionId}-t`,
        threadOrder: -1,
        name: null,
        rootMessageId: `${sessionId}-m`,
        createdAt: 1,
        compactionPoints: [],
      },
    },
    {
      type: 'message',
      message: {
        sessionId,
        threadId: `${sessionId}-t`,
        messageId: `${sessionId}-m`,
        parentMessageId: null,
        activeChildId: null,
        siblingOrder: 0,
        kind: 'message',
        branchId: null,
        createdAt: 1,
        updatedAt: 1,
        message: {
          id: `${sessionId}-m`,
          role: 'user',
          contentParts: [
            { type: 'text', text: '你好🌍\nline 2' },
            { type: 'image', storageKey: resourceId },
          ],
        },
      },
    },
  ]
}
async function archive(
  records = fixture(),
  options: {
    selection?: BackupSelection
    abort?: AbortSignal
    cleanupFails?: boolean
    codec?: BackupCodec
    limits?: Partial<BackupLimits>
    openResource?: BackupExportSource['openResource']
  } = {}
) {
  let bytes: Uint8Array = new Uint8Array()
  const workspace = new Workspace()
  if (options.cleanupFails)
    workspace.dispose = async () => {
      throw new Error('cleanup')
    }
  const opened: string[] = []
  const result = await exportBackupV3({
    archiveId: 'archive-1',
    createdAt: '2026-10-21T00:00:00.000Z',
    producer: 'test',
    selection: options.selection ?? selection,
    workspace,
    output: sink((value) => {
      bytes = value
    }),
    signal: options.abort,
    codec: options.codec,
    limits: options.limits,
    source: {
      async *records() {
        yield* records
      },
      async openResource(key, signal) {
        opened.push(key)
        if (options.openResource) return options.openResource(key, signal)
        return { source: source(encoder.encode('shared attachment')), mimeType: 'text/plain', contentType: 'text' }
      },
    },
  })
  return { bytes, workspace, opened, result }
}
class Target implements BackupImportTarget {
  records: BackupBusinessRecord[] = []
  resources = new Map<string, Uint8Array>()
  descriptors: BackupResourceRecord[] = []
  published = false
  prepared = false
  cleaned = false
  async begin(..._args: Parameters<BackupImportTarget['begin']>) {}
  async appendRecords(records: BackupBusinessRecord[]) {
    this.records.push(...records)
  }
  async createResource(resource: BackupResourceRecord) {
    this.descriptors.push(resource)
    return sink((bytes) => {
      this.resources.set(resource.resourceId, bytes)
    })
  }
  async prepare(): Promise<BackupImportSummary | void> {
    this.prepared = true
    this.published = true
  }
  getSummary(): BackupImportSummary {
    return {
      importedSessions: this.records.filter((row) => row.type === 'session').length,
      importedMessages: this.records.filter((row) => row.type === 'message').length,
      importedResources: this.resources.size,
      importedGlobals: this.records.filter((row) => row.type === 'global').length,
      skippedRecords: 0,
    }
  }
  async cleanup() {
    this.cleaned = true
  }
}
function mutate(bytes: Uint8Array, change: (entries: Record<string, Uint8Array>) => void) {
  const entries = unzipSync(bytes)
  change(entries)
  return zipSync(entries)
}

describe('V3 row archive', () => {
  it('uses only existing MIME metadata for portable attachment extensions', () => {
    expect(backupResourcePath(3, 'IMAGE/JPEG; charset=binary')).toBe('resources/000003.jpg')
    expect(backupResourcePath(3, 'application/pdf')).toBe('resources/000003.pdf')
    expect(backupResourcePath(3, 'image/webp')).toBe('resources/000003.webp')
    expect(backupResourcePath(3, 'application/unknown')).toBe('resources/000003.bin')
    expect(backupResourcePath(3, 'constructor')).toBe('resources/000003.bin')
  })
  it('keeps every entry identical across independent decoders in both import directions', async () => {
    const probe = trackedNodeCodec()
    const portable = await archive()
    const injected = await archive(fixture(), { codec: probe.codec })
    expect(unzipSync(injected.bytes)).toEqual(unzipSync(portable.bytes))
    expect(injected.result.complete).toEqual(portable.result.complete)
    expect(probe.decodes()).toBe(0)

    const portableTarget = new Target()
    await importBackupV3({ source: source(injected.bytes), workspace: new Workspace(), target: portableTarget })
    const injectedTarget = new Target()
    await importBackupV3({
      source: source(portable.bytes),
      workspace: new Workspace(),
      target: injectedTarget,
      codec: probe.codec,
    })
    expect(injectedTarget.records).toEqual(portableTarget.records)
    expect(injectedTarget.resources).toEqual(portableTarget.resources)
    expect(probe.decodes()).toBe(7) // Two controls, one configuration, and four JSONL records.
    expect(await readBackupV3Manifest(source(injected.bytes), { codec: probe.codec })).toEqual(portable.result.manifest)
    expect(probe.decodes()).toBe(8)
  })

  it('cleans temporary state when data decoding or resource staging fails', async () => {
    const { bytes } = await archive()
    for (const failure of ['decode', 'resource'] as const) {
      const probe = trackedNodeCodec()
      const target = new Target()
      if (failure === 'decode') {
        const decode = probe.codec.decodeUtf8
        let calls = 0
        probe.codec.decodeUtf8 = (input) => {
          if (++calls === 3) throw new Error('decode failed')
          return decode(input)
        }
      } else {
        target.createResource = async () => ({
          write: async () => {
            throw new Error('resource failed')
          },
          close: async () => {},
          abort: async () => {},
        })
      }
      await expect(
        importBackupV3({ source: source(bytes), workspace: new Workspace(), target, codec: probe.codec })
      ).rejects.toThrow(`${failure} failed`)
      expect(target.cleaned).toBe(true)
      expect(target.records).toHaveLength(0)
    }
  })

  it('uses one JSONL per selected conversation, MIME extensions, stable resource IDs, and a complete row round trip', async () => {
    const { bytes, opened, workspace, result } = await archive([...fixture('A'), ...fixture('C')])
    expect(opened).toEqual(['resource:共享'])
    expect(workspace.disposed).toBe(true)
    expect(Object.keys(unzipSync(bytes))).toEqual([
      'manifest.json',
      'resources/000000.txt',
      'resources.jsonl',
      'session-settings.json',
      'sessions/A.jsonl',
      'sessions/C.jsonl',
      'complete.json',
    ])
    expect(result.complete.counts).toMatchObject({ session: 2, thread: 2, message: 2, resource: 1 })
    const target = new Target()
    await importBackupV3({ source: source(bytes), workspace: new Workspace(), target })
    expect(target.published).toBe(true)
    expect(target.prepared).toBe(true)
    expect(target.cleaned).toBe(true)
    expect(target.records.filter((record) => record.type === 'session').map((record) => record.session.id)).toEqual([
      'A',
      'C',
    ])
    expect([...target.resources.keys()]).toEqual(['resource:共享'])
    expect(decoder.decode(target.resources.get('resource:共享'))).toBe('shared attachment')
    expect(target.records[2]).toMatchObject({ message: { message: { generating: false } } })
  })

  it('writes bounded configuration files with all shared keys and their exact restore scope', async () => {
    const globals: BackupBusinessRecord[] = [
      {
        type: 'global',
        category: 'settings',
        id: 'settings',
        value: { language: 'en', memoryStateToken: 'source-state' },
      },
      {
        type: 'global',
        category: 'copilot',
        id: 'copilot',
        value: { id: 'copilot', name: 'Assistant', prompt: 'Hello' },
      },
      { type: 'global', category: 'session-settings', id: 'chat-session-settings', value: { temperature: 0.5 } },
      { type: 'global', category: 'session-settings', id: 'picture-session-settings', value: {} },
      { type: 'global', category: 'folder', id: 'folder', value: { id: 'folder', name: 'Folder' } },
      { type: 'global', category: 'soul', id: 'agent-soul', value: { content: 'Persona', updatedAt: 1 } },
      {
        type: 'global',
        category: 'global-memory',
        id: 'memory',
        value: { id: 'memory', content: 'Remember', createdAt: 1 },
      },
      { type: 'global', category: 'copilot-memory', id: 'copilot', value: [] },
      {
        type: 'global',
        category: 'memory-identities',
        id: 'owner:copilot',
        value: { id: 'copilot', name: 'Assistant' },
      },
      {
        type: 'global',
        category: 'memory-identities',
        id: 'token:copilot',
        value: { id: 'copilot', token: 'state', retirementToken: 'lifetime' },
      },
    ]
    const { bytes } = await archive([...globals, ...fixture()], {
      selection: { ...selection, settings: true, copilots: true },
    })
    const entries = unzipSync(bytes)
    expect(JSON.parse(decoder.decode(entries['settings.json']))).toEqual(
      globals[0].type === 'global' ? globals[0].value : null
    )
    expect(JSON.parse(decoder.decode(entries['copilots.json']))).toEqual([
      { id: 'copilot', name: 'Assistant', prompt: 'Hello' },
    ])
    const shared = JSON.parse(decoder.decode(entries['session-settings.json'])) as Record<string, unknown>
    expect(Object.keys(shared).sort()).toEqual([
      'agent-memories',
      'agent-soul',
      'chat-session-settings',
      'copilot-memories',
      'copilot-memory-owners',
      'copilot-memory-state-tokens',
      'picture-session-settings',
      'session-folders',
    ])
    expect(shared['copilot-memory-state-tokens']).toEqual([
      { id: 'copilot', token: 'state', retirementToken: 'lifetime' },
    ])
    const target = new Target()
    let context: BackupImportContext | undefined
    target.begin = async (_manifest, _issue, _signal, input) => {
      context = input
    }
    await importBackupV3({ source: source(bytes), workspace: new Workspace(), target })
    expect(context?.includedGlobalKeys).toEqual(
      expect.arrayContaining(['settings', 'myCopilots', ...Object.keys(shared)])
    )
    expect(context?.includedGlobalKeys).toHaveLength(10)
    const actual = target.records.filter((record) => record.type === 'global')
    expect(actual).toHaveLength(globals.length)
    expect(actual).toEqual(expect.arrayContaining(globals))
    expect(decoder.decode(entries['sessions/A.jsonl'])).not.toContain('"type":"global"')
  })

  it('distinguishes missing configuration keys from explicitly empty collections', async () => {
    const { bytes } = await archive([], { selection: { ...selection, sessions: false, copilots: true } })
    const entries = unzipSync(bytes)
    expect(JSON.parse(decoder.decode(entries['copilots.json']))).toEqual([])
    expect(JSON.parse(decoder.decode(entries['session-settings.json']))).toEqual({
      'copilot-memories': {},
      'copilot-memory-owners': [],
      'copilot-memory-state-tokens': [],
    })
    delete entries['copilots.json']
    entries['session-settings.json'] = encoder.encode(JSON.stringify({ 'copilot-memory-owners': [] }))
    const target = new Target()
    let context: BackupImportContext | undefined
    target.begin = async (_manifest, _issue, _signal, input) => {
      context = input
    }
    await importBackupV3({ source: source(zipSync(entries)), workspace: new Workspace(), target })
    expect(context).toEqual({ includedGlobalKeys: ['copilot-memory-owners'] })
    expect(target.records).toEqual([])
  })

  it('keeps safe conversation IDs readable and encodes unsafe IDs without unsafe temporary filenames', async () => {
    for (const id of ['A', 'released-v1235-session', '../名字 / %', 'CON']) {
      const { bytes, workspace } = await archive(fixture(id))
      expect(Object.keys(unzipSync(bytes))).toContain(backupSessionPath(id))
      for (const name of workspace.files.keys()) expect(name).toMatch(/^[A-Za-z0-9_.-]{1,160}$/)
      const target = new Target()
      await importBackupV3({ source: source(bytes), workspace: new Workspace(), target })
      expect(target.records[0]).toMatchObject({ session: { id } })
    }
    expect(backupSessionPath('A')).toBe('sessions/A.jsonl')
    await expect(archive([...fixture('A'), ...fixture('a')])).rejects.toThrow('filenames collide')
  })

  it('permits removing an entire conversation file while retaining the other selected conversation', async () => {
    const { bytes } = await archive([...fixture('A'), ...fixture('B')], {
      selection: { ...selection, sessionIds: ['A', 'B'] },
    })
    const edited = mutate(bytes, (entries) => {
      delete entries['sessions/A.jsonl']
    })
    const target = new Target()
    const result = await importBackupV3({ source: source(edited), workspace: new Workspace(), target })
    expect(result.importReport).toMatchObject({ importedSessions: 1, importedMessages: 1, issueCount: 0 })
    expect(target.records[0]).toMatchObject({ session: { id: 'B' } })
  })

  it('enforces entry and structured-data budgets across every conversation and configuration file', async () => {
    const one = await archive(fixture('A'))
    await expect(
      archive([...fixture('A'), ...fixture('B')], { limits: { maxDataBytes: one.result.complete.dataBytes + 10 } })
    ).rejects.toThrow('data exceeds')
    await expect(
      archive([...fixture('A'), ...fixture('B')], { limits: { maxEntries: one.result.complete.entryCount } })
    ).rejects.toThrow('too many ZIP entries')
    const two = await archive([...fixture('A'), ...fixture('B')])
    await expect(
      importBackupV3({
        source: source(two.bytes),
        workspace: new Workspace(),
        target: new Target(),
        limits: { maxDataBytes: one.result.complete.dataBytes + 10 },
      })
    ).rejects.toThrow('data exceeds')
  })

  it.each(['crc', 'malformed', 'extra-header-malformed'] as const)(
    'retains completed files but never publishes the current file after %s failure',
    async (failure) => {
      const { bytes } = await archive([...fixture('A'), ...fixture('B')])
      let damaged = bytes
      if (failure === 'crc') {
        damaged = bytes.slice()
        const view = new DataView(damaged.buffer, damaged.byteOffset, damaged.byteLength)
        for (let offset = 0; offset + 46 <= damaged.length; offset++) {
          if (view.getUint32(offset, true) !== 0x02014b50) continue
          const length = view.getUint16(offset + 28, true)
          if (decoder.decode(damaged.subarray(offset + 46, offset + 46 + length)) !== 'sessions/B.jsonl') continue
          view.setUint32(offset + 16, view.getUint32(offset + 16, true) ^ 1, true)
          break
        }
      } else
        damaged = mutate(bytes, (entries) => {
          const header = failure === 'extra-header-malformed' ? JSON.stringify(fixture('B')[0]) + '\n' : ''
          entries['sessions/B.jsonl'] = encoder.encode(
            decoder.decode(entries['sessions/B.jsonl']) + header + '{bad json\n'
          )
        })
      const target = new Target()
      let pending: BackupBusinessRecord[] = []
      target.appendRecords = async (records) => {
        pending.push(...records)
      }
      target.prepare = async () => {
        target.records.push(...pending)
        pending = []
      }
      const error = await importBackupV3({ source: source(damaged), workspace: new Workspace(), target }).catch(
        (error: unknown) => error
      )
      expect(getBackupImportPartialResult(error)?.importReport).toMatchObject({
        importedSessions: 1,
        importedMessages: 1,
      })
      expect(target.records.filter((row) => row.type === 'session').map((row) => row.session.id)).toEqual(['A'])
      expect(target.cleaned).toBe(true)
    }
  )

  it('supports empty selections and preview without staging or resource decoding', async () => {
    const { bytes } = await archive([], { selection: { ...selection, sessions: false, copilots: true } })
    expect((await readBackupV3Manifest(source(bytes))).selection.copilots).toBe(true)
    const target = new Target()
    await importBackupV3({ source: source(bytes), workspace: new Workspace(), target })
    expect(target.records).toHaveLength(0)
    expect(target.published).toBe(true)
  })

  it('rejects an unselected session at the source boundary', async () => {
    await expect(archive(fixture('B'), { selection: { ...selection, sessionIds: ['A'] } })).rejects.toThrow(
      'unselected'
    )
  })

  it.each(['resource', 'data', 'complete'] as const)(
    'imports edited %s without requiring metadata recomputation',
    async (kind) => {
      const { bytes } = await archive()
      const edited = mutate(bytes, (entries) => {
        if (kind === 'resource')
          entries['resources/000000.txt'] = encoder.encode('edited attachment with a different byte length')
        if (kind === 'data')
          entries['sessions/A.jsonl'] = encoder.encode(
            decoder.decode(entries['sessions/A.jsonl']).replace('你好', 'edited message')
          )
        if (kind === 'complete')
          entries['complete.json'] = encoder.encode(
            JSON.stringify({
              archiveId: 'archive-1',
              counts: { session: 999, thread: 999, message: 999, global: 999, resource: 999, warning: 999 },
              dataBytes: 1,
              resourceBytes: 1,
              entryCount: 1,
              uncompressedBytes: 1,
            })
          )
      })
      const target = new Target()
      const result = await importBackupV3({ source: source(edited), workspace: new Workspace(), target })
      expect(target.published).toBe(true)
      expect(result.complete.counts).toMatchObject({ session: 1, thread: 1, message: 1, resource: 1 })
      expect(result.complete.dataBytes).toBe(
        Object.entries(unzipSync(edited))
          .filter(([path]) => path.endsWith('.jsonl') || path === 'session-settings.json')
          .reduce((sum, [, bytes]) => sum + bytes.length, 0)
      )
      expect(result.importReport).toMatchObject({
        importedSessions: 1,
        importedMessages: 1,
        skippedRecords: 0,
        issueCount: 0,
      })
      if (kind === 'resource') expect(target.descriptors[0].size).toBe(unzipSync(edited)['resources/000000.txt'].length)
    }
  )

  it.each(['missing-resources-index', 'extra-entry', 'invalid-record'] as const)(
    'rejects invalid archive format: %s',
    async (kind) => {
      const { bytes } = await archive()
      const invalid = mutate(bytes, (entries) => {
        if (kind === 'missing-resources-index') delete entries['resources.jsonl']
        if (kind === 'extra-entry') entries['extra.json'] = encoder.encode('{}')
        if (kind === 'invalid-record') entries['sessions/A.jsonl'] = encoder.encode('{"type":"unknown"}\n')
      })
      const target = new Target()
      await expect(importBackupV3({ source: source(invalid), workspace: new Workspace(), target })).rejects.toThrow()
      expect(target.records).toHaveLength(0)
    }
  )

  it('retains messages with undeclared resources and reports both missing and unindexed attachments', async () => {
    await expect(archive([...fixture(), ...fixture()])).rejects.toThrow('duplicate')
    const { bytes } = await archive()
    const edited = mutate(bytes, (entries) => {
      entries['resources.jsonl'] = new Uint8Array()
    })
    const target = new Target()
    const result = await importBackupV3({ source: source(edited), workspace: new Workspace(), target })
    expect(target.published).toBe(true)
    expect(target.records).toHaveLength(3)
    expect(target.resources.size).toBe(0)
    expect(result.importReport?.issues.map((issue) => issue.code)).toEqual(['unindexed-resource', 'missing-resource'])
    expect(target.records[2]).toMatchObject({
      message: { message: { contentParts: [{ type: 'text' }, { type: 'image', storageKey: 'resource:共享' }] } },
    })
  })

  it('skips a referenced resource that is missing locally and keeps the archive importable', async () => {
    const { bytes, result, workspace } = await archive([...fixture('A', 'resource-A'), ...fixture('B', 'resource-B')], {
      openResource: async (key) =>
        key === 'resource-A'
          ? null
          : { source: source(encoder.encode('B attachment')), mimeType: 'text/plain', contentType: 'text' },
    })
    expect(result.missingResources).toBe(1)
    expect(result.complete.counts.resource).toBe(1)
    expect(workspace.disposed).toBe(true)
    const entries = unzipSync(bytes)
    expect(Object.keys(entries).filter((path) => path.startsWith('resources/'))).toEqual(['resources/000000.txt'])
    expect(result.complete.entryCount).toBe(Object.keys(entries).length)
    const target = new Target()
    const imported = await importBackupV3({ source: source(bytes), workspace: new Workspace(), target })
    expect(imported.importReport).toMatchObject({ importedSessions: 2, importedMessages: 2, issueCount: 1 })
    expect(imported.importReport?.issues[0]).toMatchObject({ code: 'missing-resource', sessionId: 'A' })
    expect([...target.resources.keys()]).toEqual(['resource-B'])
  })

  it('still fails when opening an existing resource fails', async () => {
    await expect(
      archive(fixture(), {
        openResource: async () => {
          throw new Error('Resource read failed')
        },
      })
    ).rejects.toThrow('Resource read failed')
  })

  it('imports sparse resource paths after attachment deletion without losing either conversation', async () => {
    const { bytes } = await archive([...fixture('A', 'resource-A'), ...fixture('B', 'resource-B')])
    const edited = mutate(bytes, (entries) => {
      delete entries['resources/000000.txt']
      entries['complete.json'] = encoder.encode(JSON.stringify({ archiveId: 'archive-1' }))
    })
    expect((await readBackupV3Manifest(source(edited))).archiveId).toBe('archive-1')
    const target = new Target()
    const result = await importBackupV3({ source: source(edited), workspace: new Workspace(), target })
    expect(result.complete.counts).toMatchObject({ session: 2, message: 2, resource: 1 })
    expect(result.importReport).toMatchObject({ importedSessions: 2, importedMessages: 2, issueCount: 1 })
    expect(result.importReport?.issues[0]).toMatchObject({ code: 'missing-resource', sessionId: 'A' })
    expect([...target.resources.keys()]).toEqual(['resource-B'])
    expect(target.records.filter((record) => record.type === 'message')).toHaveLength(2)
  })

  it('imports an archive repacked with ZIP entries in alphabetical order', async () => {
    const { bytes } = await archive()
    const reordered = zipSync(
      Object.fromEntries(Object.entries(unzipSync(bytes)).sort(([left], [right]) => left.localeCompare(right)))
    )
    expect(Object.keys(unzipSync(reordered))[0]).toBe('complete.json')
    expect((await readBackupV3Manifest(source(reordered))).archiveId).toBe('archive-1')
    const target = new Target()
    const result = await importBackupV3({ source: source(reordered), workspace: new Workspace(), target })
    expect(target.published).toBe(true)
    expect(result.importReport).toMatchObject({
      importedSessions: 1,
      importedMessages: 1,
      skippedRecords: 0,
      issueCount: 0,
    })
  })

  it('uses actual records after messages are removed and added', async () => {
    const { bytes } = await archive([...fixture('A'), ...fixture('B')])
    const edited = mutate(bytes, (entries) => {
      const rows = Object.entries(entries)
        .filter(([path]) => path.startsWith('sessions/'))
        .flatMap(([, bytes]) =>
          decoder
            .decode(bytes)
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line) as BackupRecord)
        )
      const replacement = rows.filter((row) => row.type !== 'message' || row.message.sessionId !== 'A')
      const last = rows.at(-1)
      if (last?.type !== 'message') throw new Error('fixture')
      for (const id of ['B-added-1', 'B-added-2'])
        replacement.push({
          type: 'message',
          message: {
            ...last.message,
            messageId: id,
            parentMessageId: last.message.messageId,
            message: { ...last.message.message, id, contentParts: [{ type: 'text', text: 'Manually added 🌍' }] },
          },
        })
      for (const id of ['A', 'B']) {
        const own = replacement.filter((row) =>
          row.type === 'session'
            ? row.session.id === id
            : row.type === 'thread'
              ? row.thread.sessionId === id
              : row.type === 'message' && row.message.sessionId === id
        )
        entries[`sessions/${id}.jsonl`] = encoder.encode(own.map((row) => JSON.stringify(row)).join('\n') + '\n')
      }
    })
    const target = new Target()
    const result = await importBackupV3({ source: source(edited), workspace: new Workspace(), target })
    expect(result.complete.counts.message).toBe(3)
    expect(result.importReport?.importedMessages).toBe(3)
    expect(
      target.records.filter((record) => record.type === 'message').map((record) => record.message.messageId)
    ).toEqual(['B-m', 'B-added-1', 'B-added-2'])
  })

  it('skips missing sessions while forwarding all owned rows for host validation', async () => {
    const { bytes } = await archive([...fixture('A'), ...fixture('B'), ...fixture('C')])
    const edited = mutate(bytes, (entries) => {
      for (const id of ['A', 'B', 'C']) {
        const rows = decoder
          .decode(entries[`sessions/${id}.jsonl`])
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as BackupRecord)
        const result: BackupRecord[] = []
        for (const row of rows) {
          if (row.type === 'session' && id === 'A') continue
          if (row.type === 'thread' && id === 'B') continue
          result.push(row)
          if (row.type === 'message' && id === 'C') result.push(row)
        }
        entries[`sessions/${id}.jsonl`] = encoder.encode(result.map((row) => JSON.stringify(row)).join('\n') + '\n')
      }
    })
    const target = new Target()
    const result = await importBackupV3({ source: source(edited), workspace: new Workspace(), target })
    expect(target.published).toBe(true)
    expect(result.importReport).toMatchObject({
      importedSessions: 2,
      importedMessages: 3,
      skippedRecords: 2,
      issueCount: 2,
    })
    expect(result.importReport?.issues.map((issue) => issue.code)).toEqual(['missing-session', 'missing-session'])
    expect(result.complete.counts.message).toBe(4)
    expect(
      target.records.filter((record) => record.type === 'message').map((record) => record.message.messageId)
    ).toEqual(['B-m', 'C-m', 'C-m'])
  })

  it('caps issue details while reporting the full issue count and final host summary', async () => {
    const { bytes } = await archive()
    const edited = mutate(bytes, (entries) => {
      const rows = decoder
        .decode(entries['sessions/A.jsonl'])
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as BackupRecord)
      const last = rows.at(-1)
      if (last?.type !== 'message') throw new Error('fixture')
      rows.push(...Array.from({ length: 120 }, () => ({ ...last, message: { ...last.message, sessionId: 'missing' } })))
      entries['sessions/A.jsonl'] = encoder.encode(rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
    })
    const target = new Target()
    let reportIssue: BackupImportIssueReporter | undefined
    target.begin = async (_manifest?: unknown, issue?: BackupImportIssueReporter) => {
      reportIssue = issue
    }
    let reported = false
    target.prepare = async () => {
      if (!reported)
        reportIssue?.({
          code: 'missing-parent',
          sessionId: 'A',
          objectId: 'A-m',
          message: 'The message parent was repaired.',
        })
      reported = true
      target.getSummary = () => ({
        importedSessions: 1,
        importedMessages: 0,
        importedResources: 1,
        importedGlobals: 0,
        skippedRecords: 1,
      })
    }
    const result = await importBackupV3({ source: source(edited), workspace: new Workspace(), target })
    expect(result.importReport).toMatchObject({
      importedSessions: 1,
      importedMessages: 0,
      skippedRecords: 121,
      issueCount: 121,
    })
    expect(result.importReport?.issues).toHaveLength(100)
    expect(result.complete.counts.message).toBe(121)
  })

  it('forwards an invalid owned message without claiming the next valid occurrence of its ID', async () => {
    const { bytes } = await archive()
    const edited = mutate(bytes, (entries) => {
      const rows = decoder
        .decode(entries['sessions/A.jsonl'])
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as BackupRecord)
      const valid = rows.pop()
      if (valid?.type !== 'message') throw new Error('fixture')
      rows.push(
        { ...valid, message: { ...valid.message, message: { ...valid.message.message, id: 'wrong-id' } } },
        valid
      )
      entries['sessions/A.jsonl'] = encoder.encode(rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
    })
    const target = new Target()
    target.getSummary = () => ({
      importedSessions: 1,
      importedMessages: 1,
      importedResources: 1,
      importedGlobals: 0,
      skippedRecords: 1,
    })
    const result = await importBackupV3({ source: source(edited), workspace: new Workspace(), target })
    expect(target.records.filter((row) => row.type === 'message').map((row) => row.message.message.id)).toEqual([
      'wrong-id',
      'A-m',
    ])
    expect(result.importReport).toMatchObject({ importedSessions: 1, importedMessages: 1, skippedRecords: 1 })
  })

  it('continues reporting scanned progress for skipped records', async () => {
    const { bytes } = await archive()
    const edited = mutate(bytes, (entries) => {
      const text = decoder.decode(entries['sessions/A.jsonl'])
      const row = JSON.parse(text.trim().split('\n').at(-1)!) as Extract<BackupRecord, { type: 'message' }>
      const last = JSON.stringify({ ...row, message: { ...row.message, sessionId: 'missing' } })
      entries['sessions/A.jsonl'] = encoder.encode(`${text}${last}\n${last}\n${last}\n`)
    })
    let time = 0
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => {
      time += 101
      return time
    })
    const scannedMessages: number[] = []
    try {
      await importBackupV3({
        source: source(edited),
        workspace: new Workspace(),
        target: new Target(),
        onProgress: (state) => {
          if (state.phase === 'records') scannedMessages.push(state.messages)
        },
      })
      expect(scannedMessages).toEqual(expect.arrayContaining([1, 2, 3, 4]))
    } finally {
      clock.mockRestore()
    }
  })

  it('reports partial data and cleans unfinished temporary files when final preparation fails', async () => {
    const { bytes } = await archive()
    const target = new Target(),
      workspace = new Workspace()
    target.prepare = async () => {
      throw new Error('session failed')
    }
    try {
      await importBackupV3({ source: source(bytes), workspace, target })
      throw new Error('Expected failure')
    } catch (error) {
      expect(error).toMatchObject({ message: 'session failed' })
      expect(getBackupImportPartialResult(error)?.importReport).toMatchObject({ importedResources: 1 })
    }
    expect(target.resources.has('resource:共享')).toBe(true)
    expect(target.cleaned).toBe(true)
    expect(workspace.disposed).toBe(true)
  })

  it('returns cancellation with the already published resource count', async () => {
    const { bytes } = await archive()
    const target = new Target(),
      controller = new AbortController()
    const create = target.createResource.bind(target)
    target.createResource = async (resource) => {
      const output = await create(resource)
      return {
        ...output,
        async close() {
          await output.close()
          controller.abort()
        },
      }
    }
    const error = await importBackupV3({
      source: source(bytes),
      workspace: new Workspace(),
      target,
      signal: controller.signal,
    }).catch((error: unknown) => error)
    expect(error).toMatchObject({ name: 'AbortError' })
    expect(getBackupImportPartialResult(error)?.importReport).toMatchObject({
      importedResources: 1,
      importedSessions: 0,
    })
    expect(target.resources.has('resource:共享')).toBe(true)
    expect(target.cleaned).toBe(true)
  })

  it('keeps the first resource when a later resource fails ZIP CRC validation', async () => {
    const { bytes } = await archive([...fixture('A', 'one'), ...fixture('B', 'two')])
    const damaged = bytes.slice()
    const view = new DataView(damaged.buffer, damaged.byteOffset, damaged.byteLength)
    let changed = false
    for (let offset = 0; offset + 46 <= damaged.length; offset++) {
      if (view.getUint32(offset, true) !== 0x02014b50) continue
      const nameLength = view.getUint16(offset + 28, true)
      if (decoder.decode(damaged.subarray(offset + 46, offset + 46 + nameLength)) !== 'resources/000001.txt') continue
      view.setUint32(offset + 16, view.getUint32(offset + 16, true) ^ 1, true)
      changed = true
      break
    }
    expect(changed).toBe(true)
    const target = new Target()
    const error = await importBackupV3({ source: source(damaged), workspace: new Workspace(), target }).catch(
      (error: unknown) => error
    )
    expect(error).toMatchObject({ message: 'ZIP entry CRC mismatch: resources/000001.txt' })
    expect(getBackupImportPartialResult(error)?.importReport).toMatchObject({
      importedResources: 1,
      importedSessions: 0,
    })
    expect([...target.resources.keys()]).toEqual(['one'])
    expect(target.records).toHaveLength(0)
  })

  it('publishes resources before business rows and keeps completed data if complete.json is invalid', async () => {
    const { bytes } = await archive()
    const edited = mutate(bytes, (entries) => {
      entries['complete.json'] = encoder.encode('{bad json')
    })
    const target = new Target()
    const append = target.appendRecords.bind(target)
    target.appendRecords = async (records) => {
      expect(target.resources.has('resource:共享')).toBe(true)
      return append(records)
    }
    const error = await importBackupV3({ source: source(edited), workspace: new Workspace(), target }).catch(
      (error: unknown) => error
    )
    expect(getBackupImportPartialResult(error)?.importReport).toMatchObject({
      importedSessions: 1,
      importedMessages: 1,
      importedResources: 1,
    })
    expect(target.published).toBe(true)
    expect(target.cleaned).toBe(true)
  })

  it('reports post-commit cleanup failure as successful import with cleanup pending', async () => {
    const { bytes } = await archive()
    const target = new Target()
    target.cleanup = async () => {
      throw new Error('cleanup failed')
    }
    const result = await importBackupV3({ source: source(bytes), workspace: new Workspace(), target })
    expect(result.cleanupPending).toBe(true)
    expect(target.published).toBe(true)
  })

  it('aborts before creating a target and respects byte budgets', async () => {
    const { bytes } = await archive()
    const controller = new AbortController()
    controller.abort()
    await expect(
      importBackupV3({
        source: source(bytes),
        workspace: new Workspace(),
        target: new Target(),
        signal: controller.signal,
      })
    ).rejects.toThrow()
    await expect(
      importBackupV3({
        source: source(bytes),
        workspace: new Workspace(),
        target: new Target(),
        limits: { maxRecordBytes: 32 },
      })
    ).rejects.toThrow('byte budget')
  })

  it('decodes Unicode across byte boundaries with bounded complete records', async () => {
    const bytes = encodeLine({ text: '🌍\n汉字' })
    async function* chunks() {
      for (const byte of bytes) yield new Uint8Array([byte])
    }
    const decoded = []
    for await (const line of decodeJsonLines(chunks(), 1024)) decoded.push(line.value)
    expect(decoded).toEqual([{ text: '🌍\n汉字' }])
    async function drain(data: Uint8Array) {
      for await (const _ of decodeJsonLines(singleChunk(data), 1024)) {
      }
    }
    await expect(drain(encoder.encode('{}'))).rejects.toThrow('LF')
    await expect(drain(new Uint8Array([123, 34, 255, 34, 58, 49, 125, 10]))).rejects.toThrow()
  })

  it.each([512 * 1024, 2 * 1024 * 1024, 8 * 1024 * 1024])(
    'round trips a complete %i-byte Unicode message',
    async (size) => {
      const records = fixture()
      const record = records[2]
      if (record.type !== 'message') throw new Error('fixture')
      record.message.message.contentParts = [{ type: 'text', text: '🌍'.repeat(size / 4) }]
      const { bytes } = await archive(records)
      const target = new Target()
      await importBackupV3({ source: source(bytes), workspace: new Workspace(), target })
      expect(target.records[2]).toMatchObject({
        message: { message: { contentParts: record.message.message.contentParts } },
      })
    }
  )

  it('removes device attachment handles, preserves content references and records a warning', async () => {
    const records = fixture()
    const record = records[2]
    if (record.type !== 'message') throw new Error('fixture')
    record.message.message.files = [
      {
        id: 'f',
        name: 'file',
        fileType: 'text/plain',
        storageKey: 'resource:共享',
        localPath: '/secret/device-path',
        sessionAttachmentId: 42,
      },
    ]
    const { bytes, result } = await archive(records)
    expect(result.complete.counts.warning).toBe(1)
    expect(decoder.decode(unzipSync(bytes)['sessions/A.jsonl'])).not.toContain('/secret/device-path')
    const target = new Target()
    await importBackupV3({ source: source(bytes), workspace: new Workspace(), target })
    expect(target.records[2]).toMatchObject({
      message: { message: { files: [{ id: 'f', storageKey: 'resource:共享' }] } },
    })
  })

  it('round trips resources owned only by a large compaction summary as portable inline references', async () => {
    const records = fixture()
    const record = records[2]
    if (record.type !== 'message') throw new Error('fixture')
    record.message.kind = 'summary'
    record.message.message = {
      id: record.message.messageId,
      role: 'assistant',
      isSummary: true,
      contentParts: [{ type: 'text', text: 'summary '.repeat(30000) }],
      compactedFiles: [
        {
          id: 'covered-file',
          name: 'report.pdf',
          fileType: 'application/pdf',
          storageKey: 'parsed-report',
          rawStorageKey: 'raw-report',
          localPath: '/secret/summary-attachment',
          chatboxAIFileUUID: 'remote-file-handle',
          sessionAttachmentId: 42,
          ragMode: 'session-retrieval',
        },
      ],
      compactedLinks: [
        {
          id: 'covered-link',
          url: 'https://example.com',
          title: 'Example',
          storageKey: 'parsed-link',
          chatboxAILinkUUID: 'remote-link-handle',
        },
      ],
    }
    const { bytes, opened, result } = await archive(records)
    expect(opened).toEqual(['parsed-report', 'raw-report', 'parsed-link'])
    expect(result.complete.counts).toMatchObject({ resource: 3, warning: 1 })
    const exported = decoder.decode(unzipSync(bytes)['sessions/A.jsonl'])
    expect(exported).not.toContain('/secret/summary-attachment')
    expect(exported).not.toContain('remote-file-handle')
    expect(exported).not.toContain('remote-link-handle')
    expect(exported).not.toContain('sessionAttachmentId')
    expect(record.message.message.compactedFiles?.[0].localPath).toBe('/secret/summary-attachment')

    const target = new Target()
    await importBackupV3({ source: source(bytes), workspace: new Workspace(), target })
    expect([...target.resources.keys()]).toEqual(['parsed-report', 'raw-report', 'parsed-link'])
    const restored = target.records[2]
    if (restored.type !== 'message') throw new Error('fixture')
    expect(restored.message.message.contentParts).toEqual(record.message.message.contentParts)
    expect(restored.message.message.compactedFiles).toEqual([
      {
        id: 'covered-file',
        name: 'report.pdf',
        fileType: 'application/pdf',
        storageKey: 'parsed-report',
        rawStorageKey: 'raw-report',
        ragMode: 'inline',
      },
    ])
    expect(restored.message.message.compactedLinks?.[0].storageKey).toBe('parsed-link')
    expect(deriveMessageFacts(restored.message.message)).toMatchObject({
      fileResourceKeys: ['parsed-report', 'parsed-link'],
      attachmentOwnershipIds: [],
    })
  })

  it('provides a pull-driven export stream and cancels abandoned streams', async () => {
    const workspace = new Workspace()
    const probe = trackedNodeCodec()
    const options = {
      archiveId: 'pull',
      producer: 'test',
      selection: { ...selection, sessions: false },
      workspace,
      codec: probe.codec,
      source: {
        async *records(): AsyncIterable<BackupBusinessRecord> {},
        async openResource() {
          return null
        },
      },
    }
    const chunks: Uint8Array[] = []
    for await (const chunk of exportBackupV3Stream(options)) chunks.push(chunk)
    expect((await readBackupV3Manifest(source(combine(chunks)))).archiveId).toBe('pull')
    const abandoned = new Workspace()
    for await (const _ of exportBackupV3Stream({ ...options, workspace: abandoned })) break
    expect(abandoned.disposed).toBe(true)
  })

  it('retains the temporary workspace when cleanup cannot finish', async () => {
    const { bytes } = await archive()
    const target = new Target(),
      workspace = new Workspace()
    target.cleanup = async () => {
      throw new Error('cleanup failed')
    }
    expect((await importBackupV3({ source: source(bytes), workspace, target })).cleanupPending).toBe(true)
    expect(workspace.disposed).toBe(false)
    const failedTarget = new Target(),
      failedWorkspace = new Workspace()
    failedTarget.prepare = async () => {
      throw new Error('publish failed')
    }
    failedTarget.cleanup = async () => {
      throw new Error('cleanup failed')
    }
    await expect(
      importBackupV3({ source: source(bytes), workspace: failedWorkspace, target: failedTarget })
    ).rejects.toThrow('publish failed')
    expect(failedWorkspace.disposed).toBe(false)
  })
  it('accepts sequential normalized resource sources and closes them before cleanup', async () => {
    const payload = encoder.encode('binary resource')
    let closed = false
    let output: Uint8Array = new Uint8Array()
    const workspace = new Workspace()
    workspace.dispose = async () => {
      expect(closed).toBe(true)
    }
    await exportBackupV3({
      archiveId: 'sequential',
      producer: 'test',
      selection,
      workspace,
      output: sink((bytes) => {
        output = bytes
      }),
      source: {
        async *records() {
          yield* fixture()
        },
        async openResource() {
          return {
            mimeType: 'image/png',
            contentType: 'binary',
            source: {
              size: payload.length,
              async *chunks() {
                for (const byte of payload) yield new Uint8Array([byte])
              },
              async close() {
                closed = true
              },
            },
          }
        },
      },
    })
    expect(closed).toBe(true)
    const target = new Target()
    await importBackupV3({ source: source(output), workspace: new Workspace(), target })
    expect(target.resources.get('resource:共享')).toEqual(payload)
  })

  it('closes resource handles before disposing a failed export workspace', async () => {
    let opened = false,
      closed = false
    const workspace = new Workspace()
    workspace.dispose = async () => {
      if (opened) expect(closed).toBe(true)
    }
    await expect(
      exportBackupV3({
        archiveId: 'output-failure',
        producer: 'test',
        selection,
        workspace,
        output: {
          async write() {
            if (opened) throw new Error('disk full')
          },
          async close() {},
          async abort() {},
        },
        source: {
          async *records() {
            yield* fixture()
          },
          async openResource() {
            opened = true
            return {
              mimeType: 'image/png',
              contentType: 'binary',
              source: {
                size: 2 * 1024 * 1024,
                async *chunks() {
                  for (let i = 0; i < 32; i++) yield new Uint8Array(64 * 1024)
                },
                async close() {
                  closed = true
                },
              },
            }
          },
        },
      })
    ).rejects.toThrow('disk full')
    expect(opened).toBe(true)
    expect(closed).toBe(true)
  })
})
