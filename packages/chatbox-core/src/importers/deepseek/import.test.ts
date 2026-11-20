import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
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
  return { value, rows, metadata, images }
}
let next = 0
const createId = () => `local-${++next}`
const options = { createId, failureLabel: 'Failed' }

describe('DeepSeek conversation import', () => {
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
