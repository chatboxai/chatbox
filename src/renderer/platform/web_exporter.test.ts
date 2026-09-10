// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import WebExporter from './web_exporter'

const pickerWindow = window as Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string
    types: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<FileSystemFileHandle>
}

const originalPickerDescriptor = Object.getOwnPropertyDescriptor(window, 'showSaveFilePicker')
const originalUserAgentDescriptor = Object.getOwnPropertyDescriptor(navigator, 'userAgent')

function setSaveFilePicker(value?: typeof pickerWindow.showSaveFilePicker) {
  Object.defineProperty(window, 'showSaveFilePicker', {
    configurable: true,
    value,
  })
}

// biome-ignore lint/suspicious/useAwait: The exporter contract requires an AsyncGenerator.
async function* chunks() {
  yield new Uint8Array([1, 2])
  yield new Uint8Array([3, 4])
}

function readBlob(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error('Expected Blob to be read as an ArrayBuffer'))
        return
      }
      resolve(new Uint8Array(reader.result))
    }
    reader.readAsArrayBuffer(blob)
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  if (originalPickerDescriptor) Object.defineProperty(window, 'showSaveFilePicker', originalPickerDescriptor)
  else Reflect.deleteProperty(window, 'showSaveFilePicker')
  if (originalUserAgentDescriptor) Object.defineProperty(navigator, 'userAgent', originalUserAgentDescriptor)
})

describe('WebExporter.exportStreamingFile', () => {
  it('returns a pending download instead of reporting a Blob download as saved', async () => {
    setSaveFilePicker(undefined)

    const result = await new WebExporter().exportStreamingFile('backup.zip', chunks, 'application/zip')

    expect(result.boundedMemory).toBe(false)
    const pendingDownload = result.pendingDownload
    expect(pendingDownload).toBeDefined()
    if (!pendingDownload) throw new Error('Expected a pending download')
    expect(pendingDownload.filename).toBe('backup.zip')
    expect(pendingDownload.blob.type).toBe('application/zip')
    expect(Array.from(await readBlob(pendingDownload.blob))).toEqual([1, 2, 3, 4])
  })

  it('reports a picker export as saved only after the writable stream closes', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const close = vi.fn().mockResolvedValue(undefined)
    const abort = vi.fn().mockResolvedValue(undefined)
    const showSaveFilePicker = vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue({ write, close, abort }),
    })
    setSaveFilePicker(showSaveFilePicker)

    const result = await new WebExporter().exportStreamingFile('backup.zip', chunks, 'application/zip')

    expect(showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: 'backup.zip',
      types: [{ description: 'Chatbox backup', accept: { 'application/zip': ['.zip'] } }],
    })
    expect(write).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledOnce()
    expect(abort).not.toHaveBeenCalled()
    expect(result).toEqual({ boundedMemory: true })
  })

  it('preserves picker cancellation instead of silently falling back', async () => {
    const error = new DOMException('The user aborted a request', 'AbortError')
    setSaveFilePicker(vi.fn().mockRejectedValue(error))

    await expect(new WebExporter().exportStreamingFile('backup.zip', chunks, 'application/zip')).rejects.toBe(error)
  })

  it('falls back when the picker fails before writing starts', async () => {
    const showSaveFilePicker = vi.fn().mockRejectedValue(new DOMException('Picker is unavailable', 'SecurityError'))
    setSaveFilePicker(showSaveFilePicker)

    const result = await new WebExporter().exportStreamingFile('backup.zip', chunks, 'application/zip')

    expect(showSaveFilePicker).toHaveBeenCalledOnce()
    expect(result.boundedMemory).toBe(false)
    expect(Array.from(await readBlob(result.pendingDownload?.blob ?? new Blob()))).toEqual([1, 2, 3, 4])
  })

  it('falls back when creating the picker writable fails', async () => {
    const createWritable = vi.fn().mockRejectedValue(new DOMException('Writable is unavailable', 'NotAllowedError'))
    setSaveFilePicker(vi.fn().mockResolvedValue({ createWritable }))

    const result = await new WebExporter().exportStreamingFile('backup.zip', chunks, 'application/zip')

    expect(createWritable).toHaveBeenCalledOnce()
    expect(result.pendingDownload?.filename).toBe('backup.zip')
  })

  it('does not fall back after picker writing has started', async () => {
    const error = new Error('Disk write failed')
    const write = vi.fn().mockRejectedValue(error)
    const abort = vi.fn().mockResolvedValue(undefined)
    setSaveFilePicker(
      vi.fn().mockResolvedValue({
        createWritable: vi.fn().mockResolvedValue({ write, close: vi.fn(), abort }),
      })
    )

    await expect(new WebExporter().exportStreamingFile('backup.zip', chunks, 'application/zip')).rejects.toBe(error)
    expect(write).toHaveBeenCalledOnce()
    expect(abort).toHaveBeenCalledWith(error)
  })

  it('bypasses save pickers exposed by mobile browsers', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/138.0 Mobile Safari/537.36',
    })
    const showSaveFilePicker = vi.fn()
    setSaveFilePicker(showSaveFilePicker)

    const result = await new WebExporter().exportStreamingFile('backup.zip', chunks, 'application/zip')

    expect(showSaveFilePicker).not.toHaveBeenCalled()
    expect(result.pendingDownload?.filename).toBe('backup.zip')
  })

  it('bypasses File System Access streaming when the platform disables it', async () => {
    const showSaveFilePicker = vi.fn()
    setSaveFilePicker(showSaveFilePicker)

    const result = await new WebExporter({ allowFileSystemAccessStreaming: false }).exportStreamingFile(
      'backup.zip',
      chunks,
      'application/zip'
    )

    expect(showSaveFilePicker).not.toHaveBeenCalled()
    expect(result.boundedMemory).toBe(false)
    expect(result.pendingDownload?.filename).toBe('backup.zip')
    expect(Array.from(await readBlob(result.pendingDownload?.blob ?? new Blob()))).toEqual([1, 2, 3, 4])
  })
})
