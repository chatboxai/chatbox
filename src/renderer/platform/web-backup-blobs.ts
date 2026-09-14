import type { BackupStorage } from '@chatbox/core/backup'
import localforage from 'localforage'
import { v4 as uuid } from 'uuid'

const PREFIX = '__chatbox_blob_chunks:'
interface ChunkedBlob {
  format: 'chatbox-blob-chunks-v1'
  id: string
  count: number
}
const chunked = (value: unknown): value is ChunkedBlob =>
  !!value &&
  typeof value === 'object' &&
  'format' in value &&
  value.format === 'chatbox-blob-chunks-v1' &&
  'id' in value &&
  typeof value.id === 'string' &&
  'count' in value &&
  Number.isSafeInteger(value.count) &&
  Number(value.count) >= 0 &&
  Number(value.count) <= 65536
const partKey = (id: string, index: number) => `${PREFIX}${id}:${index}`

export const webBackupBlobs: NonNullable<BackupStorage['blobStreams']> = {
  async has(key) {
    return (await localforage.keys()).includes(key)
  },
  async read(key) {
    const value: unknown = await localforage.getItem(key)
    if (value === null) return null
    if (typeof value !== 'string' && !chunked(value)) throw new Error('Invalid stored backup resource')
    return (async function* () {
      if (typeof value === 'string') {
        // Released IndexedDB values are whole strings; the first read uses the browser's structured clone.
        for (let offset = 0; offset < value.length; offset += 32768) yield value.slice(offset, offset + 32768)
      } else {
        for (let i = 0; i < value.count; i++) {
          const part: unknown = await localforage.getItem(partKey(value.id, i))
          if (typeof part !== 'string' || part.length > 32768)
            throw new Error('Stored backup resource chunk is missing or invalid')
          yield part
        }
      }
    })()
  },
  async write(key, chunks) {
    if (await this.has(key)) throw new Error('Backup resource key already exists')
    const manifest: ChunkedBlob = { format: 'chatbox-blob-chunks-v1', id: uuid(), count: 0 }
    try {
      for await (const chunk of chunks)
        for (let offset = 0; offset < chunk.length; offset += 32768) {
          if (manifest.count >= 65536) throw new Error('Backup resource exceeds chunk budget')
          await localforage.setItem(partKey(manifest.id, manifest.count++), chunk.slice(offset, offset + 32768))
        }
      await localforage.setItem(key, manifest)
    } catch (error) {
      for (let i = 0; i < manifest.count; i++) await localforage.removeItem(partKey(manifest.id, i))
      throw error
    }
  },
}
export async function readWebBlob(key: string): Promise<string | null> {
  const source = await webBackupBlobs.read(key)
  if (!source) return null
  const parts: string[] = []
  for await (const part of source) parts.push(part)
  return parts.join('')
}
export async function deleteWebBlob(key: string) {
  const value: unknown = await localforage.getItem(key)
  if (chunked(value)) for (let i = 0; i < value.count; i++) await localforage.removeItem(partKey(value.id, i))
  await localforage.removeItem(key)
}
export async function listWebBlobKeys() {
  return (await localforage.keys()).filter((key) => !key.startsWith(PREFIX))
}

export async function writeWebBlob(key: string, value: string) {
  const previous: unknown = await localforage.getItem(key)
  await localforage.setItem(key, value)
  if (chunked(previous)) for (let i = 0; i < previous.count; i++) await localforage.removeItem(partKey(previous.id, i))
}
