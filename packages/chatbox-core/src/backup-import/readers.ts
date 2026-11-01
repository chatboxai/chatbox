import { z } from 'zod'
import { assertSafeArchivePath, readFileBytes, readZipFileEntries, type ByteSource, type ZipReadOptions } from '../io'
import { resolveBackupLimits } from '../backup-v3/schema'
import type { BackupManifest, BackupOptions } from '../backup-v3/types'
import { decodeJson } from '../backup-v3/streams'
import { throwIfAborted } from '../utils/abort'
import { GLOBAL_KEYS, object } from './legacy'
import { jsonMembers, readJsonRange, type JsonRange } from './json-ranges'
import { isLegacyResourceKey, stringResource } from './string-resource'

export const LEGACY_JSON_BYTES = 128 * 1024 * 1024
const GLOBAL_BYTES = 32 * 1024 * 1024
const descriptor = z.object({ path: z.string().min(1).max(4096) })
const manifestSchema = z.object({
  format: z.literal('chatbox-backup'),
  formatVersion: z.literal(2),
  exportedAt: z.string().optional(),
  sourceConfigVersion: z.number().int().nonnegative().optional(),
  application: z.object({ version: z.string().optional() }).optional(),
  exportItems: z.array(z.string()).optional(),
  data: z
    .object({
      settings: descriptor.optional(),
      copilots: descriptor.optional(),
      sessionSettings: descriptor.optional(),
    })
    .default({}),
  sessions: z
    .array(descriptor.extend({ id: z.string().min(1), meta: z.record(z.string(), z.unknown()).optional() }))
    .max(50000),
  resources: z
    .array(
      descriptor.extend({
        id: z.string().min(1),
        originalStorageKeys: z.array(z.string().min(1).max(8192)).min(1).max(50000),
        encoding: z.enum(['utf8', 'data-url-base64']),
        mimeType: z.string().min(1),
      })
    )
    .max(50000),
})
export type V2Manifest = z.infer<typeof manifestSchema>
export interface BackupInspection {
  formatVersion: 1 | 2 | 3
  selection: BackupManifest['selection']
}
export interface LegacySession {
  value: unknown
  expectedId?: string
  meta?: Record<string, unknown>
  bytes: number
}
export interface LegacyResource {
  path: string
  keys: string[]
  mimeType: string
  contentType: 'text' | 'binary'
  size: number
  data: AsyncIterable<Uint8Array>
}
export interface LegacyInput extends BackupInspection {
  formatVersion: 1 | 2
  globals: Map<string, unknown>
  configVersion?: number
  dataBytes: number
  entryCount: number
  readResources(consume: (resource: LegacyResource) => Promise<void>, missing: (id: string) => void): Promise<void>
  readSessions(consume: (session: LegacySession) => Promise<void>, missing: (id: string) => void): Promise<void>
}
export function zipOptions(options: BackupOptions): ZipReadOptions {
  const limits = resolveBackupLimits(options.limits)
  return {
    bounded: true,
    signal: options.signal,
    limits: {
      maxEntries: limits.maxEntries,
      maxEntryUncompressedBytes: limits.maxResourceBytes,
      maxTotalUncompressedBytes: limits.maxUncompressedBytes,
    },
  }
}
export async function zipManifest(source: ByteSource, options: BackupOptions): Promise<unknown> {
  const limits = resolveBackupLimits(options.limits)
  if (source.size > limits.maxArchiveBytes) throw new Error('Backup exceeds its size budget')
  let manifest: unknown
  await readZipFileEntries(
    source,
    (entry) => {
      manifest = decodeJson(entry.data, options.codec)
    },
    {
      ...zipOptions(options),
      filter: (path) => path === 'manifest.json',
      entryLimits: (path) => ({
        maxEntryUncompressedBytes:
          path === 'manifest.json'
            ? GLOBAL_BYTES
            : (path.startsWith('sessions/') && path.endsWith('.jsonl')) ||
                path === 'resources.jsonl' ||
                path === 'warnings.jsonl'
              ? limits.maxDataBytes
              : limits.maxResourceBytes,
      }),
    }
  )
  if (manifest === undefined) throw new Error('Backup manifest is missing')
  return manifest
}
export async function isZip(source: ByteSource): Promise<boolean> {
  const prefix = await readFileBytes(source, 0, Math.min(4, source.size))
  return prefix[0] === 80 && prefix[1] === 75
}
function selection(globals: Map<string, unknown>, sessions: boolean): BackupManifest['selection'] {
  return {
    sessions:
      sessions ||
      ['chat-session-settings', 'picture-session-settings', 'session-folders'].some((key) => globals.has(key)),
    settings: ['settings', 'agent-soul', 'agent-memories'].some((key) => globals.has(key)),
    copilots:
      globals.has('myCopilots') ||
      ['copilot-memories', 'copilot-memory-owners', 'copilot-memory-state-tokens'].some((key) => globals.has(key)),
    credentials: globals.has('settings'),
  }
}
export async function readV1(source: ByteSource, options: BackupOptions, preview = false): Promise<LegacyInput> {
  const limits = resolveBackupLimits(options.limits)
  if (source.size > limits.maxArchiveBytes) throw new Error('Backup exceeds its size budget')
  const index = new Map<string, JsonRange>()
  let indexBytes = 0
  for await (const range of jsonMembers(source, 'object', undefined, options.signal, options.codec)) {
    if (index.has(range.key)) throw new Error('Duplicate legacy backup key')
    indexBytes += range.key.length * 2 + 32
    if (index.size >= limits.maxEntries || indexBytes > GLOBAL_BYTES)
      throw new Error('Legacy backup index exceeds its size budget')
    index.set(range.key, range)
  }
  const globals = new Map<string, unknown>()
  let bytes = 0
  for (const key of GLOBAL_KEYS) {
    const range = index.get(key)
    if (!range) continue
    bytes += range.end - range.start
    if (bytes > GLOBAL_BYTES) throw new Error('Global backup data exceeds its size budget')
    globals.set(key, preview ? null : await readJsonRange(source, range, GLOBAL_BYTES, options.codec, options.signal))
  }
  const versionRange = index.get('configVersion')
  const version = versionRange
    ? await readJsonRange(source, versionRange, 128, options.codec, options.signal)
    : undefined
  if (version !== undefined && (!Number.isSafeInteger(version) || (version as number) < 0))
    throw new Error('Invalid legacy configuration version')
  const individual = [...index].filter(([key]) => key.startsWith('session:'))
  const resources = [...index].filter(([key]) => isLegacyResourceKey(key))
  const arrayRange = index.get('chat-sessions')
  if (!individual.length && !arrayRange && !globals.size && !resources.length)
    throw new Error('Unsupported legacy backup data format')
  return {
    formatVersion: 1,
    selection: selection(globals, individual.length > 0 || !!arrayRange),
    globals,
    configVersion: version as number | undefined,
    dataBytes: bytes,
    entryCount: index.size,
    async readResources(consume) {
      let resourceBytes = 0
      for (const [key, range] of resources) {
        const value = await readJsonRange(source, range, LEGACY_JSON_BYTES, options.codec, options.signal)
        const resource = stringResource(key, value, limits.maxResourceBytes, options.signal)
        resourceBytes += resource.size
        if (resourceBytes + bytes > limits.maxUncompressedBytes) throw new Error('Backup exceeds its size budget')
        await consume(resource)
      }
    },
    async readSessions(consume) {
      const metadata = new Map<string, Record<string, unknown>>()
      const metaRange = index.get('chat-sessions-list')
      if (metaRange) {
        let metadataBytes = 0
        for await (const range of jsonMembers(source, 'array', metaRange, options.signal, options.codec)) {
          metadataBytes += range.end - range.start
          if (metadataBytes > GLOBAL_BYTES) throw new Error('Legacy metadata exceeds its size budget')
          if (metadata.size >= limits.maxEntries) throw new Error('Legacy metadata exceeds its size budget')
          const value = await readJsonRange(source, range, 128 * 1024, options.codec, options.signal)
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            const meta = value as Record<string, unknown>
            if (typeof meta.id === 'string') metadata.set(meta.id, meta)
          }
        }
      }
      for (const [key, range] of individual) {
        const expectedId = key.slice(8)
        await consume({
          value: await readJsonRange(source, range, LEGACY_JSON_BYTES, options.codec, options.signal),
          expectedId,
          meta: metadata.get(expectedId),
          bytes: range.end - range.start,
        })
      }
      if (arrayRange) {
        let count = 0
        for await (const range of jsonMembers(source, 'array', arrayRange, options.signal, options.codec)) {
          if (++count > limits.maxEntries) throw new Error('Legacy session count exceeds its size budget')
          const value = await readJsonRange(source, range, LEGACY_JSON_BYTES, options.codec, options.signal)
          const id = value && typeof value === 'object' && 'id' in value ? value.id : undefined
          // Explicit per-session records are the newer representation when both are present.
          if (typeof id === 'string' && index.has(`session:${id}`)) continue
          await consume({
            value,
            meta: typeof id === 'string' ? metadata.get(id) : undefined,
            bytes: range.end - range.start,
          })
        }
      }
    },
  }
}

export async function readV2(source: ByteSource, raw: unknown, options: BackupOptions): Promise<LegacyInput> {
  const manifest = manifestSchema.parse(raw)
  const paths = new Set<string>(['manifest.json'])
  for (const item of [...Object.values(manifest.data), ...manifest.sessions, ...manifest.resources]) {
    if (!item) continue
    assertSafeArchivePath(item.path)
    if (paths.has(item.path)) throw new Error('Duplicate legacy backup path')
    paths.add(item.path)
  }
  const globals = new Map<string, unknown>()
  const globalPaths = new Map<string, string>()
  if (manifest.data.settings) globalPaths.set(manifest.data.settings.path, 'settings')
  if (manifest.data.copilots) globalPaths.set(manifest.data.copilots.path, 'myCopilots')
  if (manifest.data.sessionSettings) globalPaths.set(manifest.data.sessionSettings.path, 'map')
  let dataBytes = 0,
    entryCount = 0
  await readZipFileEntries(
    source,
    (entry) => {
      const key = globalPaths.get(entry.path)!
      dataBytes += entry.data.length
      if (dataBytes > GLOBAL_BYTES) throw new Error('Global backup data exceeds its size budget')
      const value = decodeJson(entry.data, options.codec)
      if (key === 'map') {
        for (const [key, data] of Object.entries(object(value)))
          if (GLOBAL_KEYS.includes(key as (typeof GLOBAL_KEYS)[number])) globals.set(key, data)
      } else globals.set(key, value)
      globalPaths.delete(entry.path)
    },
    {
      ...zipOptions(options),
      filter: (path) => {
        entryCount++
        return globalPaths.has(path)
      },
      entryLimits: (path) => (globalPaths.has(path) ? { maxEntryUncompressedBytes: GLOBAL_BYTES } : {}),
    }
  )
  if (globalPaths.size) throw new Error('Legacy backup settings entry is missing')
  const resources = new Map(manifest.resources.map((entry) => [entry.path, entry]))
  const sessions = new Map(manifest.sessions.map((entry) => [entry.path, entry]))
  const input: LegacyInput = {
    formatVersion: 2,
    selection: selection(globals, manifest.sessions.length > 0),
    globals,
    configVersion: manifest.sourceConfigVersion,
    dataBytes,
    entryCount,
    async readResources(consume, missing) {
      const pending = new Map(resources)
      await readZipFileEntries(
        source,
        () => {
          throw new Error('Expected streamed resource')
        },
        {
          ...zipOptions(options),
          filter: (path) => resources.has(path),
          streamEntry: () => true,
          onStreamEntry: async (entry) => {
            const descriptor = resources.get(entry.path)!
            await consume({
              path: entry.path,
              keys: descriptor.originalStorageKeys,
              mimeType: descriptor.mimeType,
              contentType: descriptor.encoding === 'utf8' ? 'text' : 'binary',
              size: entry.uncompressedSize,
              data: entry.data,
            })
            pending.delete(entry.path)
          },
        }
      )
      for (const resource of pending.values()) for (const key of resource.originalStorageKeys) missing(key)
    },
    async readSessions(consume, missing) {
      const pending = new Map(sessions)
      await readZipFileEntries(
        source,
        async (entry) => {
          throwIfAborted(options.signal)
          const descriptor = sessions.get(entry.path)!
          await consume({
            value: decodeJson(entry.data, options.codec),
            expectedId: descriptor.id,
            meta: descriptor.meta,
            bytes: entry.data.length,
          })
          pending.delete(entry.path)
        },
        {
          ...zipOptions(options),
          filter: (path) => sessions.has(path),
          entryLimits: (path) => (sessions.has(path) ? { maxEntryUncompressedBytes: LEGACY_JSON_BYTES } : {}),
        }
      )
      for (const session of pending.values()) missing(session.id)
    },
  }
  return input
}
