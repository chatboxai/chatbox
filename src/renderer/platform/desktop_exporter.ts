import { throwIfAborted } from '@chatbox/core/utils/abort'
import type { ElectronIPC } from '@shared/electron-types'
import WebExporter from './web_exporter'

export default class DesktopExporter extends WebExporter {
  constructor(private readonly ipc: Pick<ElectronIPC, 'invoke'>) {
    super()
  }

  override async exportStreamingFile(
    filename: string,
    data: () => AsyncGenerator<Uint8Array, void, unknown>,
    _mimeType: string,
    signal?: AbortSignal
  ) {
    throwIfAborted(signal)
    const token: string | null = await this.ipc.invoke('file-transfer:open-save', filename)
    if (!token) throw new DOMException('Save canceled', 'AbortError')
    try {
      throwIfAborted(signal)
      for await (const chunk of data())
        for (let offset = 0; offset < chunk.length; offset += 65536) {
          throwIfAborted(signal)
          await this.ipc.invoke('file-transfer:write', token, chunk.subarray(offset, offset + 65536))
        }
      throwIfAborted(signal)
      await this.ipc.invoke('file-transfer:finish', token, true)
      return { boundedMemory: true }
    } catch (error) {
      await this.ipc.invoke('file-transfer:finish', token, false).catch(() => undefined)
      throw error
    }
  }
}
