import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { zipSync } from 'fflate'
import { exportBackupV3 } from '../backup-v3/archive'
import { getBackupImportPartialResult } from '../backup-v3/errors'
import type {
  BackupBusinessRecord,
  BackupImportContext,
  BackupImportProjections,
  BackupImportSummary,
  BackupImportTarget,
  BackupWorkspace,
} from '../backup-v3/types'
import type { ByteSink, ClosableByteSource } from '../io'
import { importBackup, inspectBackup } from './index'
import { jsonMembers, readJsonRange } from './json-ranges'

const importOptions = { archiveId: 'fixture-import-job' }
const encoder = new TextEncoder()
const json = (value: unknown) => encoder.encode(JSON.stringify(value))
function fixtureEntries(root: string, directory = root): Array<[string, Uint8Array]> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry): Array<[string, Uint8Array]> => {
    const path = join(directory, entry.name)
    return entry.isDirectory()
      ? fixtureEntries(root, path)
      : [[relative(root, path).replaceAll('\\', '/'), new Uint8Array(readFileSync(path))]]
  })
}
function source(bytes: Uint8Array): ClosableByteSource {
  return {
    size: bytes.length,
    readBytes: async (offset, length) => bytes.slice(offset, offset + length),
    close: async () => {},
  }
}
function sink(finish: (bytes: Uint8Array) => void): ByteSink {
  const parts: Uint8Array[] = []
  return {
    write: async (part) => {
      parts.push(part.slice())
    },
    abort: async () => {
      parts.length = 0
    },
    close: async () => {
      const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
      let offset = 0
      for (const part of parts) {
        bytes.set(part, offset)
        offset += part.length
      }
      finish(bytes)
    },
  }
}
class Workspace implements BackupWorkspace {
  files = new Map<string, Uint8Array>()
  tables = new Map<string, Map<string, string>>()
  disposed = false
  private checkFileName(name: string) {
    if (!/^[A-Za-z0-9_.-]{1,160}$/.test(name) || name === '.' || name === '..')
      throw new Error('Backup workspace path is invalid')
  }
  async createFile(name: string) {
    this.checkFileName(name)
    if (this.files.has(name)) throw new Error('Backup workspace file already exists')
    return sink((bytes) => {
      this.files.set(name, bytes)
    })
  }
  async openFile(name: string) {
    this.checkFileName(name)
    if (!this.files.has(name)) throw new Error('Backup workspace file is missing')
    return source(this.files.get(name)!)
  }
  async put(table: string, key: string, value: string) {
    const values = this.tables.get(table) ?? new Map<string, string>()
    this.tables.set(table, values)
    if (values.has(key)) return false
    values.set(key, value)
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
function target() {
  const sessions = new Map<string, BackupBusinessRecord[]>(),
    resources = new Map<string, Uint8Array>()
  const globals: BackupBusinessRecord[] = []
  const projections: BackupImportProjections[] = []
  let context: BackupImportContext | undefined,
    active: BackupBusinessRecord[] = []
  const summary: BackupImportSummary = {
    importedSessions: 0,
    importedMessages: 0,
    importedResources: 0,
    importedGlobals: 0,
    skippedRecords: 0,
  }
  const target: BackupImportTarget = {
    begin: async (_manifest, _issue, _signal, imported) => {
      context = imported
    },
    appendRecords: async (records) => {
      for (const record of records) {
        if (record.type === 'global') globals.push(record)
        else active.push(record)
      }
    },
    createResource: async (resource) =>
      sink((bytes) => {
        resources.set(resource.resourceId, bytes)
        summary.importedResources++
      }),
    prepare: async (preparedProjections) => {
      if (preparedProjections) projections.push(preparedProjections)
      const first = active[0]
      if (first?.type === 'session') {
        sessions.set(first.session.id, active)
        summary.importedSessions++
        summary.importedMessages += active.filter((row) => row.type === 'message').length
        active = []
      }
      summary.importedGlobals = globals.length
      return { ...summary }
    },
    getSummary: () => ({ ...summary }),
    cleanup: async () => {
      active = []
    },
  }
  return { target, sessions, resources, globals, projections, context: () => context }
}
const session = (id: string, text = '你好 🌍') => ({
  id,
  name: id,
  messages: [{ id: `${id}-m`, role: 'user', content: text }],
})
function v2(
  sessions: unknown[],
  extra: { globals?: Record<string, unknown>; resource?: Uint8Array; missing?: boolean; corruptSession?: boolean } = {}
) {
  const entries: Record<string, Uint8Array> = {}
  const descriptors = sessions.map((value, index) => {
    const path = `sessions/encoded-${index}/session.json`
    entries[path] = extra.corruptSession && index === 1 ? encoder.encode('{bad}') : json(value)
    return {
      id: (value as { id: string }).id,
      path,
      size: 999,
      checksum: { algorithm: 'sha256', value: 'outdated' },
      meta: { id: (value as { id: string }).id, name: 'name', sortOrder: index, createdAt: 5 },
    }
  })
  const data: Record<string, { path: string }> = {}
  for (const [key, value] of Object.entries(extra.globals ?? {})) {
    const path = `${key}.json`
    entries[path] = json(value)
    data[key] = { path }
  }
  const resources = extra.resource
    ? [
        {
          id: 'resource-000001',
          path: 'resources/picture.bin',
          originalStorageKeys: ['picture:one', 'picture:alias'],
          encoding: 'data-url-base64',
          mimeType: 'image/png',
          size: 1,
        },
      ]
    : []
  if (extra.resource && !extra.missing) entries['resources/picture.bin'] = extra.resource
  entries['manifest.json'] = json({
    format: 'chatbox-backup',
    formatVersion: 2,
    sourceConfigVersion: 15,
    data,
    sessions: descriptors,
    resources,
  })
  return source(zipSync(entries))
}

describe('published backup import', () => {
  it.each([
    [1, false],
    [1, true],
    [2, false],
    [2, true],
  ] as const)('provides converted V%s fork navigation at preparation (empty selection: %s)', async (version, empty) => {
    const branched = {
      id: 'branched',
      name: 'Branches',
      messages: [
        { id: 'pivot', role: 'user', content: 'Question' },
        { id: 'summary', role: 'assistant', content: 'Summary', isSummary: true },
        ...(!empty ? [{ id: 'answer', role: 'assistant', content: 'Answer' }] : []),
      ],
      messageForksHash: {
        pivot: {
          createdAt: 42,
          position: 1,
          lists: [
            { id: 'saved', messages: [{ id: 'alternative', role: 'assistant', content: 'Alternative' }] },
            { id: 'current', messages: [] },
          ],
        },
      },
    }
    const plain = { id: 'plain', name: 'Plain', messages: [{ id: 'pivot', role: 'user', content: 'Another question' }] }
    const restored = target()
    await importBackup({
      ...importOptions,
      source: version === 1 ? source(json({ 'chat-sessions': [branched, plain] })) : v2([branched, plain]),
      workspace: new Workspace(),
      target: restored.target,
    })
    expect(restored.projections).toHaveLength(2)
    expect(restored.projections[0].sessionId).toBe('branched')
    expect([...restored.projections[0].forks]).toEqual([
      ['pivot', { pivotId: 'pivot', branchPointId: 'summary', selectedBranchId: 'current', count: 2, position: 1 }],
    ])
    expect(restored.projections[1].sessionId).toBe('plain')
    expect(restored.projections[1].forks.size).toBe(0)
    for (const record of restored.sessions.get('branched') ?? []) {
      if (record.type === 'message') expect(record.message).not.toHaveProperty('fork')
    }
  })

  it('uses the host job identity when Web Crypto is unavailable', async () => {
    vi.stubGlobal('crypto', undefined)
    try {
      for (const file of [source(json({ 'session:a': session('a') })), v2([session('a')])]) {
        const restored = target()
        const result = await importBackup({
          ...importOptions,
          source: file,
          workspace: new Workspace(),
          target: restored.target,
        })
        expect(result.manifest.archiveId).toBe(importOptions.archiveId)
        expect(result.importReport?.importedSessions).toBe(1)
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('indexes object and array values across UTF-8/chunk boundaries without whole-file reads', async () => {
    const values = [session('a', '界'.repeat(40000)), session('b', 'escaped \\" } ], : string')]
    const bytes = encoder.encode(
      `\uFEFF  ${JSON.stringify({ 'chat-sessions': values, settings: { language: 'en' } })} \n`
    )
    const ranges = []
    for await (const member of jsonMembers(source(bytes), 'object')) ranges.push(member)
    const elements = []
    for await (const member of jsonMembers(source(bytes), 'array', ranges[0])) elements.push(member)
    expect(elements).toHaveLength(2)
    expect(await readJsonRange(source(bytes), elements[1], 1000)).toEqual(values[1])
    const reads: number[] = []
    const monitored = {
      size: bytes.length,
      readBytes: async (offset: number, size: number) => {
        reads.push(size)
        return bytes.slice(offset, offset + size)
      },
    }
    const restored = target()
    const result = await importBackup({
      ...importOptions,
      source: monitored,
      workspace: new Workspace(),
      target: restored.target,
    })
    expect(result.importReport).toMatchObject({ importedSessions: 2, importedMessages: 2 })
    expect(Math.max(...reads)).toBeLessThanOrEqual(65536)
  })

  it.each(['{"x":1,}', '{"x":[1,2}', '{"x":1}garbage', '{"x":1,"x":2}'])(
    'rejects invalid outer JSON %s',
    async (text) => {
      await expect(inspectBackup(source(encoder.encode(text)))).rejects.toThrow()
    }
  )

  it('imports V1 per-ID and early arrays, preferring the explicit record and preserving metadata', async () => {
    const restored = target()
    const file = source(
      json({
        configVersion: 15,
        'chat-sessions': [session('a', 'older'), session('b')],
        'session:a': session('a', 'newer'),
        'chat-sessions-list': [{ id: 'a', sortOrder: 9, createdAt: 7 }],
        myCopilots: [],
        'agent-memories': [],
      })
    )
    expect(await inspectBackup(file)).toMatchObject({
      formatVersion: 1,
      selection: { sessions: true, settings: true, copilots: true },
    })
    const result = await importBackup({
      ...importOptions,
      source: file,
      workspace: new Workspace(),
      target: restored.target,
    })
    expect(result.importReport).toMatchObject({ importedSessions: 2, importedMessages: 2 })
    expect(restored.sessions.get('a')?.[0]).toMatchObject({ meta: { sortOrder: 9, createdAt: 7 } })
    expect(restored.sessions.get('a')?.[2]).toMatchObject({
      message: { message: { contentParts: [{ type: 'text', text: 'newer' }] } },
    })
    expect(restored.context()?.includedGlobalKeys).toEqual(['myCopilots', 'agent-memories'])
  })

  it('normalizes flat provider settings and legacy message content without touching normal migrations', async () => {
    const restored = target()
    await importBackup({
      ...importOptions,
      source: source(
        json({
          configVersion: 9,
          settings: { aiProvider: 'openai', openaiKey: 'fixture', model: 'gpt-test' },
          'session:a': { ...session('a'), settings: { aiProvider: 'openai' } },
        })
      ),
      workspace: new Workspace(),
      target: restored.target,
    })
    expect(restored.globals[0]).toMatchObject({ value: { providers: { openai: { apiKey: 'fixture' } } } })
    expect(restored.sessions.get('a')?.[0]).toMatchObject({
      session: { settings: { provider: 'openai', modelId: 'gpt-test' } },
    })
  })

  it('preserves an unspecified provider when importing pre-v10 sessions', async () => {
    const restored = target()
    await importBackup({
      ...importOptions,
      source: source(json({ configVersion: 9, 'session:a': session('a') })),
      workspace: new Workspace(),
      target: restored.target,
    })
    const row = restored.sessions.get('a')?.[0]
    expect(row?.type === 'session' && row.session.settings?.provider).toBeUndefined()
  })

  it('restores pre-v10 custom provider configurations and session model references without Web Crypto', async () => {
    // Persisted field names follow the released v1.9.0 CustomProvider/ModelSettings contracts.
    const fixture = new Uint8Array(
      readFileSync(fileURLToPath(new URL('./fixtures/pre-v10-providers.json', import.meta.url)))
    )
    vi.stubGlobal('crypto', undefined)
    try {
      const restored = target()
      const result = await importBackup({
        ...importOptions,
        source: source(fixture),
        workspace: new Workspace(),
        target: restored.target,
      })
      const one = `custom-provider-${importOptions.archiveId}-0`,
        two = `custom-provider-${importOptions.archiveId}-1`
      expect(restored.globals[0]).toMatchObject({
        value: {
          customProviders: [
            { id: one, name: 'Fixture One', isCustom: true, type: 'openai' },
            { id: two, name: 'Fixture Two', isCustom: true, type: 'openai' },
          ],
          providers: {
            [one]: {
              apiKey: 'fixture-one',
              apiHost: 'https://one.example.test',
              apiPath: '/chat/completions',
              useProxy: true,
              models: [{ modelId: 'model-one' }, { modelId: 'model-extra' }],
            },
            [two]: {
              apiKey: 'fixture-two',
              apiHost: 'https://two.example.test',
              apiPath: '/responses',
              useProxy: false,
              models: [{ modelId: 'model-two' }],
            },
          },
        },
      })
      expect(restored.sessions.get('local-model')?.[0]).toMatchObject({
        session: { settings: { provider: two, modelId: 'session-model' } },
      })
      expect(restored.sessions.get('global-model')?.[0]).toMatchObject({
        session: { settings: { provider: one, modelId: 'model-one' } },
      })
      expect(result.importReport).toMatchObject({ importedSessions: 2, skippedRecords: 0, issueCount: 0 })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it.each([
    ['openai', 'openai'],
    ['gemini', 'chatbox-ai'],
  ])('restores pre-v10 picture settings with %s', async (sourceProvider, expectedProvider) => {
    const restored = target()
    await importBackup({
      ...importOptions,
      source: source(
        json({
          configVersion: 9,
          settings: { aiProvider: sourceProvider, model: 'chat-model', geminiModel: 'chat-model' },
          'session:picture': { ...session('picture'), type: 'picture' },
        })
      ),
      workspace: new Workspace(),
      target: restored.target,
    })
    expect(restored.sessions.get('picture')?.[0]).toMatchObject({
      session: {
        settings: { provider: expectedProvider, modelId: 'DALL-E-3', imageGenerateNum: 3, dalleStyle: 'vivid' },
      },
    })
  })

  it('restores all resources and global key coverage from the released v1.23.5 fixtures', async () => {
    const root = fileURLToPath(new URL('../testing/fixtures/published-backups/', import.meta.url))
    const globals = [
      'settings',
      'myCopilots',
      'chat-session-settings',
      'picture-session-settings',
      'agent-memories',
      'copilot-memories',
      'copilot-memory-owners',
      'copilot-memory-state-tokens',
    ]
    const original = JSON.parse(readFileSync(join(root, 'v1-released.json'), 'utf8')) as Record<string, unknown>
    for (const name of [
      'v1-released.json',
      'v1-released-empty-settings.json',
      'v2-released',
      'v2-released-missing-settings',
    ]) {
      const path = join(root, name)
      const bytes = name.endsWith('.json')
        ? new Uint8Array(readFileSync(path))
        : zipSync(Object.fromEntries(fixtureEntries(path)))
      const restored = target()
      const result = await importBackup({
        ...importOptions,
        source: source(bytes),
        workspace: new Workspace(),
        target: restored.target,
      })
      expect(result.importReport).toMatchObject({
        importedSessions: 1,
        importedMessages: 3,
        importedResources: 4,
        skippedRecords: 0,
        issueCount: 0,
      })
      expect([...(restored.context()?.includedGlobalKeys ?? [])].sort()).toEqual(
        name === 'v1-released-empty-settings.json' || name === 'v2-released' ? [...globals].sort() : []
      )
      for (const [key, value] of Object.entries(original)) {
        if (typeof value !== 'string') continue
        const expected = value.startsWith('data:')
          ? new Uint8Array(Buffer.from(value.slice(value.indexOf(',') + 1), 'base64'))
          : encoder.encode(value)
        expect(restored.resources.get(key)).toEqual(expected)
      }
    }
  })

  it('streams V1 UTF-8 and binary values across chunk boundaries under original keys', async () => {
    const text = 'x'.repeat(65535) + '🌍' + '界'.repeat(30000)
    const binary = new Uint8Array(90000).map((_, index) => index % 256)
    const restored = target()
    await importBackup({
      ...importOptions,
      source: source(
        json({ 'file:text': text, 'picture:image': `data:image/png;base64,${Buffer.from(binary).toString('base64')}` })
      ),
      workspace: new Workspace(),
      target: restored.target,
    })
    expect(restored.resources.get('file:text')).toEqual(encoder.encode(text))
    expect(restored.resources.get('picture:image')).toEqual(binary)
  })

  it('uses portable unique temporary files for multiple aliased V2 resources', async () => {
    const directory = fileURLToPath(new URL('../testing/fixtures/published-backups/v2-released/', import.meta.url))
    const workspace = new Workspace(),
      restored = target()
    const result = await importBackup({
      ...importOptions,
      source: source(zipSync(Object.fromEntries(fixtureEntries(directory)))),
      workspace,
      target: restored.target,
    })
    expect(result.importReport).toMatchObject({ importedResources: 4, issueCount: 0 })
    expect(workspace.files.size).toBe(2)
    expect(new Set([...workspace.files.values()].map((bytes) => Array.from(bytes).join(','))).size).toBe(2)
  })

  it('rejects malformed V1 base64 before publishing that resource', async () => {
    const restored = target()
    await expect(
      importBackup({
        ...importOptions,
        source: source(json({ 'picture:bad': 'data:image/png;base64,ab$=' })),
        workspace: new Workspace(),
        target: restored.target,
      })
    ).rejects.toThrow('Invalid legacy resource base64')
    expect(restored.resources.size).toBe(0)
  })

  it('reads existing V1 and V2 format fixtures', async () => {
    const fixture = (path: string) =>
      new Uint8Array(
        readFileSync(fileURLToPath(new URL(`../testing/fixtures/published-backups/${path}`, import.meta.url)))
      )
    for (const file of [
      source(fixture('v1.json')),
      source(
        zipSync({
          'manifest.json': fixture('v2/manifest.json'),
          'sessions/fixture-session/session.json': fixture('v2/sessions/fixture-session/session.json'),
        })
      ),
    ]) {
      const restored = target()
      const result = await importBackup({
        ...importOptions,
        source: file,
        workspace: new Workspace(),
        target: restored.target,
      })
      expect(result.importReport).toMatchObject({ importedSessions: 1, importedMessages: 1, issueCount: 0 })
    }
  })

  it('restores every original key from a deduplicated V2 binary and accepts advisory sizes/checksums', async () => {
    const restored = target(),
      bytes = new Uint8Array([137, 80, 78, 71, 0, 255])
    const value = {
      ...session('id/汉.字'),
      messages: [{ id: 'm', role: 'user', contentParts: [{ type: 'image', storageKey: 'picture:alias' }] }],
    }
    const file = v2([value], {
      resource: bytes,
      globals: {
        settings: { language: 'en' },
        sessionSettings: { 'chat-session-settings': {}, 'copilot-memories': {} },
      },
    })
    expect((await inspectBackup(file)).formatVersion).toBe(2)
    const result = await importBackup({
      ...importOptions,
      source: file,
      workspace: new Workspace(),
      target: restored.target,
    })
    expect(result.importReport).toMatchObject({
      importedSessions: 1,
      importedMessages: 1,
      importedResources: 2,
      issueCount: 0,
    })
    expect(restored.resources.get('picture:one')).toEqual(bytes)
    expect(restored.resources.get('picture:alias')).toEqual(bytes)
    expect(restored.context()?.includedGlobalKeys).toEqual(['settings', 'chat-session-settings', 'copilot-memories'])
  })

  it('keeps missing resource references and reports the problem once', async () => {
    const value = {
      ...session('a'),
      messages: [{ id: 'm', role: 'user', contentParts: [{ type: 'image', storageKey: 'picture:one' }] }],
    }
    const restored = target()
    const result = await importBackup({
      ...importOptions,
      source: v2([value], { resource: new Uint8Array([1]), missing: true }),
      workspace: new Workspace(),
      target: restored.target,
    })
    expect(result.importReport).toMatchObject({ importedSessions: 1, importedResources: 0, issueCount: 2 })
    expect(restored.sessions.get('a')?.[2]).toMatchObject({
      message: { message: { contentParts: [{ type: 'image', storageKey: 'picture:one' }] } },
    })
  })

  it('preserves completed sessions after a later malformed entry and cancellation', async () => {
    for (const cancel of [false, true]) {
      const restored = target(),
        controller = new AbortController(),
        prepare = restored.target.prepare
      restored.target.prepare = async (projections) => {
        const result = await prepare(projections)
        if (cancel && result?.importedSessions === 1) controller.abort()
        return result
      }
      let failure: unknown
      try {
        await importBackup({
          ...importOptions,
          source: v2([session('a'), session('b')], { corruptSession: !cancel }),
          workspace: new Workspace(),
          target: restored.target,
          signal: controller.signal,
        })
      } catch (error) {
        failure = error
      }
      expect(getBackupImportPartialResult(failure)?.importReport).toMatchObject({
        importedSessions: 1,
        importedMessages: 1,
      })
      expect([...restored.sessions.keys()]).toEqual(['a'])
      if (cancel) expect(failure).toMatchObject({ name: 'AbortError' })
    }
  })

  it('skips invalid sessions and caps report details', async () => {
    const entries = Object.fromEntries(
      Array.from({ length: 104 }, (_, i) => [`session:${i}`, { id: String(i), name: 'bad', messages: 'bad' }])
    )
    const restored = target()
    const result = await importBackup({
      ...importOptions,
      source: source(json(entries)),
      workspace: new Workspace(),
      target: restored.target,
    })
    expect(result.importReport).toMatchObject({ importedSessions: 0, skippedRecords: 104, issueCount: 104 })
    expect(result.importReport?.issues).toHaveLength(100)
  })

  it('delegates V3 inspection and importing to the existing codec', async () => {
    let bytes: Uint8Array = new Uint8Array()
    await exportBackupV3({
      archiveId: 'fixture',
      producer: 'test',
      selection: { sessions: false, settings: false, copilots: false, credentials: false },
      source: { async *records() {}, openResource: async () => null },
      workspace: new Workspace(),
      output: sink((value) => {
        bytes = value
      }),
    })
    expect((await inspectBackup(source(bytes))).formatVersion).toBe(3)
    const restored = target()
    const result = await importBackup({
      ...importOptions,
      source: source(bytes),
      workspace: new Workspace(),
      target: restored.target,
    })
    expect(result.manifest.archiveId).toBe('fixture')
    expect(restored.context()).toEqual({ includedGlobalKeys: [] })
    expect(restored.projections).toEqual([])
  })
})
