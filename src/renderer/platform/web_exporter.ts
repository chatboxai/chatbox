import * as base64 from '@/packages/base64'
import type { Exporter, StreamingExportResult } from './interfaces'

function isMobileBrowser() {
  const { userAgent, platform, maxTouchPoints } = navigator
  return /Android|iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)
}

function isAbortError(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === 'AbortError'
}

interface WebExporterOptions {
  allowFileSystemAccessStreaming?: boolean
}

export default class WebExporter implements Exporter {
  private readonly allowFileSystemAccessStreaming: boolean

  constructor({ allowFileSystemAccessStreaming = true }: WebExporterOptions = {}) {
    this.allowFileSystemAccessStreaming = allowFileSystemAccessStreaming
  }

  exportBlob(filename: string, blob: Blob, _encoding?: 'utf8' | 'ascii' | 'utf16'): Promise<void> {
    const eleLink = document.createElement('a')
    eleLink.download = filename
    eleLink.style.display = 'none'
    const url = URL.createObjectURL(blob)
    eleLink.href = url
    document.body.appendChild(eleLink)
    eleLink.click()
    document.body.removeChild(eleLink)
    // Revoke after a tick to ensure the download has started.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return Promise.resolve()
  }

  exportTextFile(filename: string, content: string): Promise<void> {
    const eleLink = document.createElement('a')
    eleLink.download = filename
    eleLink.style.display = 'none'
    const blob = new Blob([content])
    const url = URL.createObjectURL(blob)
    eleLink.href = url
    document.body.appendChild(eleLink)
    eleLink.click()
    document.body.removeChild(eleLink)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return Promise.resolve()
  }

  exportImageFile(basename: string, base64Data: string): Promise<void> {
    // 解析 base64 数据
    let { type, data } = base64.parseImage(base64Data)
    if (type === '') {
      type = 'image/png'
      data = base64Data
    }
    const ext = (type.split('/')[1] || 'png').split('+')[0] // 处理 svg+xml 的情况
    const filename = `${basename}.${ext}`

    const raw = window.atob(data)
    const rawLength = raw.length
    const uInt8Array = new Uint8Array(rawLength)
    for (let i = 0; i < rawLength; ++i) {
      uInt8Array[i] = raw.charCodeAt(i)
    }
    const blob = new Blob([uInt8Array], { type })
    const eleLink = document.createElement('a')
    eleLink.download = filename
    eleLink.style.display = 'none'
    const url = URL.createObjectURL(blob)
    eleLink.href = url
    document.body.appendChild(eleLink)
    eleLink.click()
    document.body.removeChild(eleLink)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return Promise.resolve()
  }

  exportByUrl(filename: string, url: string): Promise<void> {
    const eleLink = document.createElement('a')
    eleLink.style.display = 'none'
    eleLink.download = filename
    eleLink.href = url
    document.body.appendChild(eleLink)
    eleLink.click()
    document.body.removeChild(eleLink)
    return Promise.resolve()
  }

  async exportStreamingJson(filename: string, dataCallback: () => AsyncGenerator<string, void, unknown>) {
    const encoder = new TextEncoder()
    await this.exportStreamingFile(
      filename,
      async function* () {
        for await (const chunk of dataCallback()) yield encoder.encode(chunk)
      },
      'application/json'
    )
  }

  async exportStreamingFile(
    filename: string,
    dataCallback: () => AsyncGenerator<Uint8Array, void, unknown>,
    mimeType: string,
    signal?: AbortSignal
  ): Promise<StreamingExportResult> {
    const pickerWindow = window as Window & {
      showSaveFilePicker?: (options: {
        suggestedName: string
        types: Array<{ description: string; accept: Record<string, string[]> }>
      }) => Promise<FileSystemFileHandle>
    }
    // Mobile browser implementations of showSaveFilePicker are inconsistent:
    // some expose the method but reject it before showing a usable save surface.
    // Build the Blob first and require a fresh user click to download it instead.
    if (this.allowFileSystemAccessStreaming && pickerWindow.showSaveFilePicker && !isMobileBrowser()) {
      const extension = filename.includes('.') ? `.${filename.split('.').pop()}` : ''
      let writable: FileSystemWritableFileStream | undefined
      try {
        const handle = await pickerWindow.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'Chatbox backup', accept: { [mimeType]: extension ? [extension] : [] } }],
        })
        writable = await handle.createWritable()
      } catch (error) {
        // A rejected picker means "cancel" only when the browser explicitly
        // reports AbortError. Other setup failures happen before the generator
        // is consumed, so it is safe to fall back to an explicit download.
        if (signal?.aborted) throw signal.reason ?? new DOMException('Operation canceled', 'AbortError')
        if (isAbortError(error)) throw error
      }

      if (writable) {
        try {
          for await (const chunk of dataCallback()) {
            if (signal?.aborted) throw signal.reason ?? new DOMException('Operation canceled', 'AbortError')
            await writable.write(Uint8Array.from(chunk).buffer)
          }
          await writable.close()
          return { boundedMemory: true }
        } catch (error) {
          await writable.abort(error).catch(() => undefined)
          throw error
        }
      }
    }

    // Browsers without File System Access cannot stream a download to disk. Keep
    // chunks as Blob parts so we avoid a second concatenated byte array, and report
    // the capability downgrade to the caller.
    const parts: BlobPart[] = []
    for await (const chunk of dataCallback()) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Operation canceled', 'AbortError')
      parts.push(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer)
    }
    return {
      boundedMemory: false,
      pendingDownload: {
        filename,
        blob: new Blob(parts, { type: mimeType }),
      },
    }
  }
}
