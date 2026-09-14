import type { BackupStorage } from '@chatbox/core/backup'
import type { ElectronIPC } from '@shared/electron-types'

export function desktopBackupBlobs(ipc: Pick<ElectronIPC, 'invoke'>): NonNullable<BackupStorage['blobStreams']> {
  const open = (key: string): Promise<{ token: string; size: number } | null> => ipc.invoke('backup:blob-open', key)
  return {
    async has(key) {
      const file = await open(key)
      if (!file) return false
      await ipc.invoke('backup:file-finish', file.token, false)
      return true
    },
    async read(key) {
      const file = await open(key)
      if (!file) return null
      return (async function* () {
        const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
        try {
          for (let offset = 0; offset < file.size; offset += 65536) {
            const bytes: Uint8Array = await ipc.invoke(
              'backup:file-read',
              file.token,
              offset,
              Math.min(65536, file.size - offset)
            )
            if (bytes.length !== Math.min(65536, file.size - offset))
              throw new Error('Backup resource changed during read')
            yield decoder.decode(bytes, { stream: true })
          }
          const tail = decoder.decode()
          if (tail) yield tail
        } finally {
          await ipc.invoke('backup:file-finish', file.token, false)
        }
      })()
    },
    async write(key, chunks) {
      const token: string = await ipc.invoke('backup:blob-create', key)
      try {
        let pending = ''
        for await (const chunk of chunks) {
          const value = pending + chunk
          const last = value.charCodeAt(value.length - 1)
          pending = last >= 0xd800 && last <= 0xdbff ? value.slice(-1) : ''
          const bytes = new TextEncoder().encode(pending ? value.slice(0, -1) : value)
          for (let offset = 0; offset < bytes.length; offset += 65536)
            await ipc.invoke('backup:file-write', token, bytes.subarray(offset, offset + 65536))
        }
        if (pending) await ipc.invoke('backup:file-write', token, new TextEncoder().encode(pending))
        await ipc.invoke('backup:file-finish', token, true)
      } catch (error) {
        await ipc.invoke('backup:file-finish', token, false)
        throw error
      }
    },
  }
}
