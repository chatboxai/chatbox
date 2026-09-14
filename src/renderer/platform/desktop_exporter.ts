import { throwIfAborted } from '@chatbox/core/backup'
import type { ElectronIPC } from '@shared/electron-types'
import WebExporter from './web_exporter'

export default class DesktopExporter extends WebExporter {
  constructor(private readonly ipc: ElectronIPC) {
    super()
  }
  override async exportStreamingFile(
    filename: string,
    data: () => AsyncGenerator<Uint8Array, void, unknown>,
    _mime: string,
    signal?: AbortSignal
  ) {
    throwIfAborted(signal)
    const token: string | null = await this.ipc.invoke('backup:file-open', filename)
    if (!token) throw new DOMException('Save canceled', 'AbortError')
    try {
      for await (const chunk of data())
        for (let offset = 0; offset < chunk.length; offset += 65536) {
          throwIfAborted(signal)
          await this.ipc.invoke('backup:file-write', token, chunk.subarray(offset, offset + 65536))
        }
      throwIfAborted(signal)
      await this.ipc.invoke('backup:file-finish', token, true)
      return { boundedMemory: true }
    } catch (error) {
      await this.ipc.invoke('backup:file-finish', token, false)
      throw error
    }
  }
}
