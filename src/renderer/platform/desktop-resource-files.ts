import type { ByteSink, ClosableByteSource } from '@chatbox/core/io'
import type { ElectronIPC } from '@shared/electron-types'
import type { ResourceFileStorage } from './interfaces'

const CHUNK_BYTES = 65536

export function desktopResourceFiles(ipc: Pick<ElectronIPC, 'invoke'>): ResourceFileStorage {
  return {
    async open(key): Promise<ClosableByteSource | null> {
      const file: { token: string; size: number } | null = await ipc.invoke('file-transfer:open-resource', key)
      if (!file) return null
      let closed = false
      const close = async () => {
        if (closed) return
        await ipc.invoke('file-transfer:finish', file.token, false)
        closed = true
      }
      const readBytes = async (offset: number, length: number) => {
        if (closed) throw new Error('Resource file is closed')
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.size)
          throw new Error('Invalid resource read offset')
        if (!Number.isSafeInteger(length) || length < 0) throw new Error('Invalid resource read length')
        const result = new Uint8Array(Math.min(length, file.size - offset))
        for (let written = 0; written < result.length; written += CHUNK_BYTES) {
          const count = Math.min(CHUNK_BYTES, result.length - written)
          const bytes: Uint8Array = await ipc.invoke('file-transfer:read', file.token, offset + written, count)
          if (bytes.length !== count) throw new Error('Resource file changed during read')
          result.set(bytes, written)
        }
        return result
      }
      return {
        size: file.size,
        close,
        readBytes,
        async *chunks() {
          let failed = false
          try {
            for (let offset = 0; offset < file.size; offset += CHUNK_BYTES)
              yield await readBytes(offset, Math.min(CHUNK_BYTES, file.size - offset))
          } catch (error) {
            failed = true
            throw error
          } finally {
            if (failed) await close().catch(() => undefined)
            else await close()
          }
        },
      }
    },
    async create(key): Promise<ByteSink> {
      const token: string = await ipc.invoke('file-transfer:create-resource', key)
      let closed = false
      const finish = async (commit: boolean) => {
        if (closed) return
        await ipc.invoke('file-transfer:finish', token, commit)
        closed = true
      }
      return {
        async write(bytes) {
          if (closed) throw new Error('Resource file is closed')
          for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES)
            await ipc.invoke('file-transfer:write', token, bytes.subarray(offset, offset + CHUNK_BYTES))
        },
        close: () => finish(true),
        abort: () => finish(false),
      }
    },
  }
}
