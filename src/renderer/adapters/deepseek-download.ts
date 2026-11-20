import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import type { BackupWorkspace } from '@chatbox/core/backup-v3'
import type { ByteSource } from '@chatbox/core/io'
import { throwIfAborted } from '@chatbox/core/utils/abort'
import { v4 as uuid } from 'uuid'
import platform from '@/platform'

export interface ArchiveSource {
  source: ByteSource
  close(): Promise<void>
}
export interface DownloadProgress {
  received: number
  total?: number
}

async function saveResponse(
  response: Response,
  workspace: BackupWorkspace,
  signal: AbortSignal,
  onProgress: (progress: DownloadProgress) => void
): Promise<ArchiveSource> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const sink = await workspace.createFile('download')
  const total = Number(response.headers.get('content-length')) || undefined
  let received = 0
  const reader = response.body?.getReader()
  try {
    if (reader) {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        throwIfAborted(signal)
        await sink.write(value)
        received += value.length
        if (received > 4 * 1024 ** 3) throw new Error('Archive is too large')
        onProgress({ received, total })
      }
    } else {
      const bytes = new Uint8Array(await response.arrayBuffer())
      throwIfAborted(signal)
      await sink.write(bytes)
      onProgress({ received: bytes.length, total: bytes.length })
    }
    await sink.close()
    const source = await workspace.openFile('download')
    return { source, close: () => source.close() }
  } catch (error) {
    await sink.abort()
    throw error
  } finally {
    await reader?.cancel().catch(() => {})
  }
}

export async function downloadDeepSeekArchive(
  url: string,
  workspace: BackupWorkspace,
  signal: AbortSignal,
  onProgress: (progress: DownloadProgress) => void
): Promise<ArchiveSource> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
    throw new Error('Please enter an HTTPS download link.')
  throwIfAborted(signal)
  if (platform.type === 'desktop') {
    const ipc = window.electronAPI,
      id = uuid()
    const cancel = () => {
      void ipc.invoke('deepseek-download:close', id).catch(() => {})
    }
    signal.addEventListener('abort', cancel, { once: true })
    const timer = setInterval(() => {
      void ipc.invoke('deepseek-download:progress', id).then(onProgress, () => {})
    }, 250)
    try {
      const file: { size: number } = await ipc.invoke('deepseek-download:start', id, url)
      throwIfAborted(signal)
      return {
        source: {
          size: file.size,
          async readBytes(offset, length) {
            throwIfAborted(signal)
            const bytes = new Uint8Array(length)
            for (let written = 0; written < length; written += 65536) {
              const chunk: Uint8Array = await ipc.invoke(
                'deepseek-download:read',
                id,
                offset + written,
                Math.min(65536, length - written)
              )
              bytes.set(chunk, written)
            }
            return bytes
          },
        },
        close: async () => {
          signal.removeEventListener('abort', cancel)
          await ipc.invoke('deepseek-download:close', id)
        },
      }
    } catch (error) {
      signal.removeEventListener('abort', cancel)
      await ipc.invoke('deepseek-download:close', id)
      throwIfAborted(signal)
      throw error
    } finally {
      clearInterval(timer)
    }
  }
  if (platform.type === 'mobile') {
    const path = `deepseek-${uuid()}.zip`
    const remove = async () => {
      await Filesystem.deleteFile({ directory: Directory.Cache, path }).catch(() => {})
    }
    const listener = await Filesystem.addListener('progress', (event) => {
      if (event.url === url && !signal.aborted)
        onProgress({ received: event.bytes, total: event.contentLength || undefined })
    })
    const download = Filesystem.downloadFile({ url, directory: Directory.Cache, path, progress: true })
    let abort: (() => void) | undefined
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => reject(new DOMException('Download cancelled', 'AbortError'))
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
    try {
      const result = await Promise.race([download, interrupted])
      throwIfAborted(signal)
      const uri = result.path || (await Filesystem.getUri({ directory: Directory.Cache, path })).uri
      const response = await fetch(Capacitor.convertFileSrc(uri), { signal })
      return await saveResponse(response, workspace, signal, onProgress)
    } finally {
      if (abort) signal.removeEventListener('abort', abort)
      await listener.remove()
      void download.then(remove, remove)
    }
  }
  return saveResponse(await fetch(url, { signal, credentials: 'omit' }), workspace, signal, onProgress)
}
