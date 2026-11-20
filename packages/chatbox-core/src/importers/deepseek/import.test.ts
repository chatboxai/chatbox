import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BackupWorkspace } from '../../backup-v3/types'
import { type NodeSessionRowSqlDatabase, openNodeSessionRowDatabase } from '../../persistence/node-sqlite.test-support'
import { SqlSessionRowStore } from '../../persistence/session-row-sql'
import type { SessionMetaRecord } from '../../types'
import { convertDeepSeekSession } from './convert'
import { type DeepSeekImportHost, importDeepSeekArchive, inspectDeepSeekArchive } from './index'

const at = '2024-01-01T00:00:00Z'
const message = (id: number, parent_id: number | null, role = 'USER', text = String(id)) => ({
  id,
  parent_id,
  role,
  status: 'FINISHED',
  inserted_at: at,
  fragments: [{ type: role === 'USER' ? 'REQUEST' : 'RESPONSE', content: text }],
})
const session = (
  id = 'source',
  messages = [message(1, null), message(2, 1, 'ASSISTANT')],
  current = messages.at(-1)?.id ?? 0
) => ({
  id,
  title: id,
  pinned: false,
  inserted_at: at,
  updated_at: at,
  current_message_id: current,
  messages,
})
const archive = (sessions: Record<string, unknown>, extra: Record<string, Uint8Array> = {}) => {
  const entries: Record<string, Uint8Array> = { 'manifest.json': strToU8('{"export_format_version":3}') }
  for (const [id, value] of Object.entries(sessions))
    entries[`chat_sessions/${id}.json`] = strToU8(typeof value === 'string' ? value : JSON.stringify(value))
  return new Blob([Uint8Array.from(zipSync({ ...entries, ...extra }))])
}
function workspace(): BackupWorkspace {
  const files = new Map<string, Uint8Array>(),
    tables = new Map<string, string>()
  return {
    async createFile(name) {
      const chunks: Uint8Array[] = []
      return {
        write: async (bytes) => {
          chunks.push(bytes.slice())
        },
        close: async () => {
          const data = new Uint8Array(chunks.reduce((n, bytes) => n + bytes.length, 0))
          let offset = 0
          for (const chunk of chunks) {
            data.set(chunk, offset)
            offset += chunk.length
          }
          files.set(name, data)
        },
        abort: async () => {
          files.delete(name)
        },
      }
    },
    async openFile(name) {
      const data = files.get(name)
      if (!data) throw new Error('Missing temporary file')
      return {
        size: data.length,
        readBytes: async (offset, length) => data.slice(offset, offset + length),
        close: async () => {},
      }
    },
    async put(table, key, value) {
      const k = `${table}:${key}`
      if (tables.has(k)) return false
      tables.set(k, value)
      return true
    },
    async get(table, key) {
      return tables.get(`${table}:${key}`) ?? null
    },
    async *entries() {},
    async dispose() {
      files.clear()
      tables.clear()
    },
  }
}
const databases: NodeSessionRowSqlDatabase[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const db of databases.splice(0)) db.close()
})
function host() {
  const db = openNodeSessionRowDatabase()
  databases.push(db)
  const rows = new SqlSessionRowStore(db),
    metadata: SessionMetaRecord[] = [],
    images = new Map<string, Uint8Array>()
  const value: DeepSeekImportHost = {
    jobId: 'test-import',
    workspace: workspace(),
    rows,
    metadata: {
      createMany: async (entries) => {
        metadata.push(...entries)
      },
    },
    resources: {
      open: async () => null,
      stage: async (_job, resource) => {
        const chunks: Uint8Array[] = []
        return {
          write: async (bytes) => {
            chunks.push(bytes.slice())
          },
          close: async () => {
            images.set(resource.resourceId, new Uint8Array(chunks.flatMap((chunk) => [...chunk])))
          },
          abort: async () => {},
        }
      },
      publish: async () => {},
      cleanup: async () => {},
    },
  }
  return { value, rows, metadata, images, db }
}
let next = 0
const createId = () => `local-${++next}`
const options = { createId, failureLabel: 'Failed' }

describe('DeepSeek conversation import', () => {
  it('stages the thread and a small conversation in one database batch', async () => {
    const target = host()
    const execute = vi.spyOn(target.db, 'executeBatch')
    const result = await importDeepSeekArchive({
      ...options,
      source: archive({ source: session() }),
      host: target.value,
    })
    expect(result).toMatchObject({ importedSessions: 1, importedMessages: 2, issueCount: 0 })
    const inserts = execute.mock.calls
      .map(([statements]) => [...statements])
      .filter((statements) =>
        statements.some((statement) => /^INSERT INTO session_(threads|messages)_staging\(/.test(statement.sql))
      )
    expect(inserts).toHaveLength(1)
    expect(inserts[0].some((statement) => statement.sql.startsWith('INSERT INTO session_threads_staging('))).toBe(true)
    expect(inserts[0].some((statement) => statement.sql.startsWith('INSERT INTO session_messages_staging('))).toBe(true)
  })

  it.each([0, 1, 127, 128, 255, 256])('preserves all %i messages across combined staging boundaries', async (count) => {
    const input = session(
      'source',
      Array.from({ length: count }, (_, index) =>
        message(index + 1, index ? index : null, index % 2 ? 'ASSISTANT' : 'USER', `body-${index + 1}`)
      )
    )
    const target = host()
    const sizes: number[] = []
    const stage = target.rows.stageImportRows.bind(target.rows)
    vi.spyOn(target.rows, 'stageImportRows').mockImplementation(async (...args) => {
      const writer = await stage(...args)
      const append = writer.appendRows.bind(writer)
      writer.appendRows = async (rows) => {
        sizes.push(rows.length)
        await append(rows)
      }
      return writer
    })
    const result = await importDeepSeekArchive({ ...options, source: archive({ source: input }), host: target.value })
    expect(result).toMatchObject({ importedSessions: 1, importedMessages: count, skippedSessions: 0, issueCount: 0 })
    expect(sizes.every((size) => size <= 128)).toBe(true)
    const stored = []
    for await (const row of target.rows.iterateRows({ sessionId: result.firstSessionId! }))
      if (row.kind === 'message') stored.push(row.message)
    expect(stored).toHaveLength(count)
    const byId = new Map(stored.map((row) => [row.messageId, row]))
    expect(byId.size).toBe(count)
    for (let index = 0; index < count; index++) {
      const row = byId.get(`${result.firstSessionId}:${index + 1}`)
      expect(row?.parentMessageId).toBe(index ? `${result.firstSessionId}:${index}` : null)
      expect(row?.message.contentParts).toEqual([{ type: 'text', text: `body-${index + 1}` }])
      expect(row?.message.timestamp).toBe(Date.parse(at))
    }
  })

  it('retains both replies when a fork pivot ends the combined first batch', async () => {
    const messages = Array.from({ length: 127 }, (_, index) =>
      message(index + 1, index ? index : null, index % 2 ? 'ASSISTANT' : 'USER')
    )
    messages.push(
      message(128, 127, 'ASSISTANT'),
      message(129, 127, 'ASSISTANT'),
      message(130, 128),
      message(131, 130, 'ASSISTANT')
    )
    const target = host()
    const result = await importDeepSeekArchive({
      ...options,
      source: archive({ source: session('source', messages, 131) }),
      host: target.value,
    })
    expect(result).toMatchObject({ importedSessions: 1, importedMessages: 131, issueCount: 0 })
    const stored = []
    for await (const row of target.rows.iterateRows({ sessionId: result.firstSessionId! }))
      if (row.kind === 'message') stored.push(row.message)
    const byId = new Map(stored.map((row) => [row.messageId, row]))
    expect([...byId.keys()].sort()).toEqual(messages.map((row) => `${result.firstSessionId}:${row.id}`).sort())
    expect(byId.get(`${result.firstSessionId}:127`)?.fork).toMatchObject({ count: 2, position: 0 })
    expect(byId.get(`${result.firstSessionId}:127`)?.activeChildId).toBe(`${result.firstSessionId}:128`)
    expect(byId.get(`${result.firstSessionId}:129`)?.parentMessageId).toBe(`${result.firstSessionId}:127`)
    expect(byId.get(`${result.firstSessionId}:128`)?.activeChildId).toBe(`${result.firstSessionId}:130`)
    expect(byId.get(`${result.firstSessionId}:130`)?.activeChildId).toBe(`${result.firstSessionId}:131`)
  })

  it('keeps an earlier commit and discards the candidate cancelled after its first combined append', async () => {
    const target = host(),
      controller = new AbortController(),
      stage = target.rows.stageImportRows.bind(target.rows)
    let cancelledId: string | undefined
    vi.spyOn(target.rows, 'stageImportRows').mockImplementation(async (...args) => {
      const writer = await stage(...args)
      if (args[0].name === 'b') {
        cancelledId = args[0].id
        const append = writer.appendRows.bind(writer)
        writer.appendRows = async (rows) => {
          await append(rows)
          controller.abort()
        }
      }
      return writer
    })
    const result = await importDeepSeekArchive({
      ...options,
      source: archive({ a: session('a'), b: session('b') }),
      host: target.value,
      signal: controller.signal,
    })
    expect(result).toMatchObject({ cancelled: true, importedSessions: 1, importedMessages: 2 })
    expect(target.metadata.map((record) => record.name)).toEqual(['a'])
    expect(await target.rows.readExportCommit(result.firstSessionId!)).not.toBeNull()
    expect(cancelledId).toBeDefined()
    expect(await target.rows.readExportCommit(cancelledId!)).toBeNull()
    for (const table of ['session_threads_staging', 'session_messages_staging'])
      expect(
        await target.db.query(`SELECT COUNT(*) AS count FROM ${table} WHERE session_id=?`, [cancelledId!])
      ).toEqual([{ count: 0 }])
  })

  it.each([1, 2])(
    'disposes a candidate when combined append %i fails and continues with the next conversation',
    async (failAt) => {
      const target = host(),
        stage = target.rows.stageImportRows.bind(target.rows)
      let rejectedId: string | undefined
      vi.spyOn(target.rows, 'stageImportRows').mockImplementation(async (...args) => {
        const writer = await stage(...args)
        if (args[0].name === 'bad') {
          rejectedId = args[0].id
          let appends = 0
          const append = writer.appendRows.bind(writer)
          writer.appendRows = async (rows) => {
            await append(rows)
            if (++appends === failAt) throw new Error('Controlled combined append failure')
          }
        }
        return writer
      })
      const messages = Array.from({ length: 256 }, (_, index) =>
        message(index + 1, index ? index : null, index % 2 ? 'ASSISTANT' : 'USER')
      )
      const result = await importDeepSeekArchive({
        ...options,
        source: archive({ bad: session('bad', messages), good: session('good') }),
        host: target.value,
      })
      expect(result).toMatchObject({ importedSessions: 1, importedMessages: 2, skippedSessions: 1, processed: 2 })
      expect(target.metadata.map((record) => record.name)).toEqual(['good'])
      expect(rejectedId).toBeDefined()
      expect(await target.rows.readExportCommit(rejectedId!)).toBeNull()
      for (const table of ['session_threads_staging', 'session_messages_staging'])
        expect(
          await target.db.query(`SELECT COUNT(*) AS count FROM ${table} WHERE session_id=?`, [rejectedId!])
        ).toEqual([{ count: 0 }])
    }
  )

  it('counts conversations in preview without reading large conversation payloads', async () => {
    const text = createHash('shake256', { outputLength: 2 * 1024 * 1024 })
      .update('deepseek-preview-fixture')
      .digest('base64')
    const fixture = archive(
      { a: session('a', [message(1, null, 'USER', text)]), b: session('b') },
      { 'chat_sessions/a_files/attachment.json': strToU8('{}') }
    )
    const bytes = new Uint8Array(await fixture.arrayBuffer())
    let bytesRead = 0
    const source = {
      size: bytes.length,
      readBytes: (offset: number, length: number) => {
        bytesRead += length
        return Promise.resolve(bytes.slice(offset, offset + length))
      },
    }
    expect(await inspectDeepSeekArchive(source)).toBe(2)
    expect(bytesRead).toBeLessThan(bytes.length / 4)
  })

  it('still requires a supported manifest during preview', async () => {
    const source = archive({ source: session() }, { 'manifest.json': strToU8('{"export_format_version":2}') })
    await expect(inspectDeepSeekArchive(source)).rejects.toThrow('Unsupported DeepSeek export')
  })

  it('rejects corrupt conversation payloads during import even when header-only preview succeeds', async () => {
    const bytes = zipSync(
      {
        'manifest.json': strToU8('{"export_format_version":3}'),
        'chat_sessions/source.json': strToU8(JSON.stringify(session())),
      },
      { level: 0 }
    )
    // Keep the headers and JSON valid, but change the stored body without updating its CRC.
    const offset = Buffer.from(bytes).indexOf('"title":"source"')
    expect(offset).toBeGreaterThan(0)
    bytes[offset + '"title":"'.length] ^= 1
    const source = new Blob([Uint8Array.from(bytes)])
    expect(await inspectDeepSeekArchive(source)).toBe(1)
    const target = host()
    const result = await importDeepSeekArchive({ ...options, source, host: target.value })
    expect(result).toMatchObject({ importedSessions: 0, importedMessages: 0, importedImages: 0 })
    expect(result.error).toContain('CRC mismatch')
    expect(target.metadata).toHaveLength(0)
    expect(result.firstSessionId).toBeUndefined()
  })

  it('preserves ordinary text, reasoning, sources and images with current creation time and fallback identity', async () => {
    const fixture = session()
    fixture.messages[0].fragments = [
      { type: 'REQUEST', content: 'Original **question**' },
      {
        type: 'FILE',
        files: [
          {
            id: 'image',
            file_name: 'image.png',
            file_size: 16,
            is_image: true,
            export_path: 'chat_sessions/source_files/image.png',
          },
        ],
      },
    ] as (typeof fixture.messages)[0]['fragments']
    fixture.messages[1].fragments = [
      { type: 'THINK', content: 'Reasoning', elapsed_secs: 1.5 },
      { type: 'RESPONSE', content: '```mermaid\ngraph TD\nA-->B\n```\n\\(x^2\\)' },
      { type: 'TOOL_SEARCH', results: [{ title: 'Source', url: 'https://example.com', snippet: 'Summary' }] },
    ] as (typeof fixture.messages)[1]['fragments']
    const source = archive(
      { source: fixture },
      { 'chat_sessions/source_files/image.png': Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10) }
    )
    expect(await inspectDeepSeekArchive(source)).toBe(1)
    const target = host(),
      before = Date.now()
    const result = await importDeepSeekArchive({ ...options, source, host: target.value })
    expect(result).toMatchObject({ importedSessions: 1, importedMessages: 2, importedImages: 1, issueCount: 0 })
    expect(target.metadata[0].createdAt).toBeGreaterThanOrEqual(before)
    const stored = []
    for await (const row of target.rows.iterateRows({ sessionId: result.firstSessionId! })) stored.push(row)
    const messages = stored.flatMap((row) => (row.kind === 'message' ? [row.message.message] : []))
    expect(messages[0].timestamp).toBe(Date.parse(at))
    expect(messages[1]).not.toHaveProperty('aiProvider')
    expect(messages[1].contentParts[0]).toMatchObject({ type: 'reasoning', duration: 1500 })
    expect(messages[1].contentParts).toContainEqual(
      expect.objectContaining({ type: 'info', values: expect.objectContaining({ kind: 'deepseek-sources' }) })
    )
    expect(target.images.size).toBe(1)
  })
  it('preserves both first-prompt versions, nested replies and the selected older path', async () => {
    const input = session(
      'branches',
      [
        message(1, null),
        message(2, 1, 'ASSISTANT'),
        message(4, null),
        message(5, 4, 'ASSISTANT'),
        message(8, 4, 'ASSISTANT'),
        message(9, 5),
        message(10, 9, 'ASSISTANT'),
      ],
      10
    )
    const target = host(),
      result = await importDeepSeekArchive({ ...options, source: archive({ branches: input }), host: target.value })
    expect(result).toMatchObject({ importedSessions: 1, importedMessages: 7, skippedSessions: 0, issueCount: 0 })
    const rows = []
    for await (const row of target.rows.iterateRows({ sessionId: result.firstSessionId! }))
      if (row.kind === 'message') rows.push(row.message)
    expect(rows).toHaveLength(8)
    const root = rows.find((row) => row.message.role === 'system')!
    expect(root.fork).toMatchObject({ count: 2, position: 1 })
    expect(rows.find((row) => row.messageId.endsWith(':4'))?.fork).toMatchObject({ count: 2, position: 0 })
    expect(rows.find((row) => row.messageId.endsWith(':4'))?.activeChildId).toBe(`${result.firstSessionId}:5`)
    expect(rows.find((row) => row.messageId.endsWith(':8'))).toBeDefined()
  })
  it('skips a broken conversation and continues with valid conversations', async () => {
    const target = host()
    const result = await importDeepSeekArchive({
      ...options,
      source: archive({ bad: '{broken', good: session('good') }),
      host: target.value,
    })
    expect(result).toMatchObject({ importedSessions: 1, skippedSessions: 1, processed: 2 })
    expect(target.metadata[0].name).toBe('good')
  })
  it('keeps committed conversations when cancelled', async () => {
    const target = host(),
      controller = new AbortController()
    const result = await importDeepSeekArchive({
      ...options,
      source: archive({ a: session('a'), b: session('b') }),
      host: target.value,
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.processed === 1) controller.abort()
      },
    })
    expect(result).toMatchObject({ cancelled: true, importedSessions: 1, importedMessages: 2 })
    expect(await target.rows.readExportCommit(result.firstSessionId!)).not.toBeNull()
    expect(target.metadata).toHaveLength(1)
  })
  it('creates independent local identities when importing the same source twice', async () => {
    const target = host(),
      source = archive({ source: session() })
    const first = await importDeepSeekArchive({ ...options, source, host: target.value })
    const second = await importDeepSeekArchive({
      ...options,
      source,
      host: { ...target.value, workspace: workspace() },
    })
    expect(first.firstSessionId).not.toBe(second.firstSessionId)
    expect(target.metadata).toHaveLength(2)
  })
  it('retains the descendants of failed replies and does not replay hints as normal answers', async () => {
    const input = session('errors', [
      message(1, null),
      { ...message(2, 1, 'ASSISTANT', 'Limit notice'), status: 'CONTEXT_LENGTH_EXCEEDED' },
      message(4, 2),
      message(5, 4, 'ASSISTANT'),
    ])
    const converted = await convertDeepSeekSession(input, {
      sessionId: 'local',
      importedAt: Date.now(),
      issue: () => {},
      resolveImage: async () => null,
      failureLabel: 'Failed',
    })
    expect(converted.rows).toHaveLength(4)
    expect(converted.rows[1].message.error).toBe('Limit notice')
    expect(converted.rows[2].parentMessageId).toBe('local:2')
  })
})
