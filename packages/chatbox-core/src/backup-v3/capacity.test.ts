import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { ByteSink, ClosableByteSource } from '../io'
import { exportBackupV3, importBackupV3 } from './archive'
import type { BackupBusinessRecord, BackupImportTarget, BackupWorkspace } from './types'

async function fileSource(path: string): Promise<ClosableByteSource> {
  const handle = await open(path, 'r')
  return {
    size: (await handle.stat()).size,
    async readBytes(offset, length) {
      const bytes = new Uint8Array(length)
      const read = await handle.read(bytes, 0, length, offset)
      return bytes.subarray(0, read.bytesRead)
    },
    close: () => handle.close(),
  }
}
async function fileSink(path: string): Promise<ByteSink> {
  const handle = await open(path, 'w')
  let closed = false
  return {
    async write(bytes) {
      let offset = 0
      while (offset < bytes.length) offset += (await handle.write(bytes.subarray(offset))).bytesWritten
    },
    async close() {
      if (!closed) {
        closed = true
        await handle.close()
      }
    },
    async abort() {
      if (!closed) {
        closed = true
        await handle.close()
      }
      await rm(path, { force: true })
    },
  }
}

/** Explicit disk/CPU probe; the regular codec suite exercises the same pipeline with bounded fixtures. */
it.runIf(process.env.CHATBOX_V3_CAPACITY === '1')(
  'streams a single conversation JSONL over 512 MiB with bounded incremental memory',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chatbox-v3-capacity-'))
    const messageCount = 2049
    const body = 'x'.repeat(256 * 1024)
    const startRss = process.memoryUsage().rss
    let peakRss = startRss
    const onProgress = () => {
      peakRss = Math.max(peakRss, process.memoryUsage().rss)
    }
    const workspace = (prefix: string): BackupWorkspace => {
      // This fixture has ~2,000 short identity records, independent of its 512 MiB of message bodies.
      const tables = new Map<string, Map<string, string>>()
      return {
        createFile: (name) => fileSink(join(directory, `${prefix}-${name}`)),
        openFile: (name) => fileSource(join(directory, `${prefix}-${name}`)),
        async put(table, key, value) {
          const values = tables.get(table) ?? new Map<string, string>()
          tables.set(table, values)
          if (values.has(key)) return false
          values.set(key, value)
          return true
        },
        async get(table, key) {
          return tables.get(table)?.get(key) ?? null
        },
        async *entries(table) {
          for (const [key, value] of tables.get(table) ?? []) yield { key, value }
        },
        async dispose() {
          tables.clear()
        },
      }
    }
    try {
      const result = await exportBackupV3({
        archiveId: 'capacity',
        producer: 'capacity-test',
        workspace: workspace('export'),
        selection: { sessions: true, settings: false, copilots: false, credentials: false },
        output: await fileSink(join(directory, 'backup.zip')),
        compressionLevel: 1,
        onProgress,
        source: {
          async *records(): AsyncIterable<BackupBusinessRecord> {
            yield { type: 'session', session: { id: 's', name: 'capacity', activeThreadId: 't' } }
            yield {
              type: 'thread',
              thread: {
                sessionId: 's',
                threadId: 't',
                seq: -1,
                name: null,
                rootMessageId: 'm0',
                createdAt: 0,
                compactionPoints: [],
              },
            }
            for (let index = 0; index < messageCount; index++)
              yield {
                type: 'message',
                message: {
                  sessionId: 's',
                  threadId: 't',
                  messageId: `m${index}`,
                  parentMessageId: index === 0 ? null : `m${index - 1}`,
                  activeChildId: index + 1 < messageCount ? `m${index + 1}` : null,
                  seq: 0,
                  branchId: null,
                  kind: 'message',
                  createdAt: 0,
                  updatedAt: 0,
                  message: { id: `m${index}`, role: 'user', contentParts: [{ type: 'text', text: body }] },
                },
              }
          },
          async openResource() {
            return null
          },
        },
      })
      expect(result.complete.dataBytes).toBeGreaterThan(512 * 1024 * 1024)
      let received = 0
      let published = false
      const target: BackupImportTarget = {
        async begin() {},
        async appendRecords(records) {
          received += records.filter((record) => record.type === 'message').length
        },
        async createResource() {
          throw new Error('No resources expected')
        },
        async prepare() {
          published = true
        },
        getSummary: () => ({
          importedSessions: 1,
          importedMessages: received,
          importedResources: 0,
          importedGlobals: 0,
          skippedRecords: 0,
        }),
        async cleanup() {},
      }
      const input = await fileSource(join(directory, 'backup.zip'))
      try {
        await importBackupV3({ source: input, workspace: workspace('import'), target, onProgress })
      } finally {
        await input.close()
      }
      expect(received).toBe(messageCount)
      expect(published).toBe(true)
      expect(peakRss - startRss).toBeLessThan(256 * 1024 * 1024)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
  180_000
)
