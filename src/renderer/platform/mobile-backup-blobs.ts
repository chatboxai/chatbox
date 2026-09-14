import type { BackupFile, BackupStorage } from '@chatbox/core/backup'
import type LocalForage from 'localforage'
import { v4 as uuid } from 'uuid'

type NativeBlob = { format: 'chatbox-native-blob-v1'; key: string }
interface NativeValues {
  openBackupValue(key: string): Promise<BackupFile | null>
  writeStream(key: string, chunks: AsyncIterable<string>): Promise<void>
  getItem(key: string): Promise<string | null>
  removeItem(key: string): Promise<void>
}
function pointer(value: unknown): NativeBlob | undefined {
  if (typeof value !== 'object' || value === null) return
  const record = value as Record<string, unknown>
  if (
    record.format === 'chatbox-native-blob-v1' &&
    typeof record.key === 'string' &&
    record.key.startsWith('__chatbox_backup_resource:')
  )
    return record as NativeBlob
}

export function mobileBackupBlobs(store: LocalForage, native: NativeValues) {
  const streams: NonNullable<BackupStorage['blobStreams']> = {
    async has(key) {
      return (await store.keys()).includes(key)
    },
    async read(key) {
      const value = await store.getItem<unknown>(key)
      if (value === null) return null
      const ref = pointer(value)
      if (!ref) {
        if (typeof value !== 'string') throw new Error('Invalid backup resource')
        return (async function* () {
          for (let offset = 0; offset < value.length; offset += 32768) yield value.slice(offset, offset + 32768)
        })()
      }
      const file = await native.openBackupValue(ref.key)
      if (!file?.readBytes) throw new Error('Backup resource is missing')
      const read = file.readBytes.bind(file)
      return (async function* () {
        const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
        for (let offset = 0; offset < file.size; offset += 65536) {
          const length = Math.min(65536, file.size - offset)
          const bytes = await read(offset, length)
          if (bytes.length !== length) throw new Error('Backup resource changed during read')
          yield decoder.decode(bytes, { stream: true })
        }
        const tail = decoder.decode()
        if (tail) yield tail
      })()
    },
    async write(key, chunks) {
      if (await streams.has(key)) throw new Error('Backup resource already exists')
      const ref: NativeBlob = { format: 'chatbox-native-blob-v1', key: `__chatbox_backup_resource:${uuid()}` }
      await native.writeStream(ref.key, chunks)
      try {
        await store.setItem(key, ref)
      } catch (error) {
        await native.removeItem(ref.key)
        throw error
      }
    },
  }
  return {
    streams,
    async get(key: string): Promise<string | null> {
      const value = await store.getItem<unknown>(key)
      const ref = pointer(value)
      if (ref) return native.getItem(ref.key)
      if (value === null || typeof value === 'string') return value
      throw new Error('Invalid backup resource')
    },
    async set(key: string, value: string) {
      const old = pointer(await store.getItem(key))
      await store.setItem(key, value)
      if (old) await native.removeItem(old.key)
    },
    async remove(key: string) {
      const old = pointer(await store.getItem(key))
      await store.removeItem(key)
      if (old) await native.removeItem(old.key)
    },
  }
}
