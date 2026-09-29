import { beforeEach, describe, expect, test, vi } from 'vitest'

const { filesystemMock, toastMock, shareMock, documentSaverMock, loggerMock, buildPlatformMock } = vi.hoisted(() => ({
  filesystemMock: {
    appendFile: vi.fn(),
    checkPermissions: vi.fn(),
    deleteFile: vi.fn(),
    downloadFile: vi.fn(),
    getUri: vi.fn(),
    mkdir: vi.fn(),
    requestPermissions: vi.fn(),
    stat: vi.fn(),
    writeFile: vi.fn(),
  },
  toastMock: {
    show: vi.fn(),
  },
  shareMock: {
    share: vi.fn(),
  },
  documentSaverMock: {
    saveFile: vi.fn(),
  },
  loggerMock: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  buildPlatformMock: {
    value: 'android',
  },
}))

vi.mock('@capacitor/filesystem', () => ({
  Directory: {
    Cache: 'CACHE',
    Documents: 'DOCUMENTS',
  },
  Encoding: {
    UTF8: 'utf8',
  },
  Filesystem: filesystemMock,
}))

vi.mock('@capacitor/share', () => ({
  Share: shareMock,
}))

vi.mock('@capacitor/toast', () => ({ Toast: toastMock }))
vi.mock('@/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('@/lib/utils', () => ({ getLogger: () => loggerMock }))
vi.mock('@/variables', () => ({
  get CHATBOX_BUILD_PLATFORM() {
    return buildPlatformMock.value
  },
}))
vi.mock('./android_document_saver', () => ({ AndroidDocumentSaver: documentSaverMock }))

import { AndroidFilterWriter, getRedactedUrlForLog, HandledExportError, isSaveCanceledError } from './filter_writer'
import MobileExporter from './mobile_exporter'

describe('AndroidFilterWriter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    filesystemMock.checkPermissions.mockResolvedValue({ publicStorage: 'granted' })
    filesystemMock.mkdir.mockResolvedValue(undefined)
    filesystemMock.writeFile.mockResolvedValue({ uri: 'cache://temporary-export' })
    filesystemMock.appendFile.mockResolvedValue(undefined)
    filesystemMock.deleteFile.mockResolvedValue(undefined)
    filesystemMock.getUri.mockResolvedValue({ uri: 'file://saved-export' })
    filesystemMock.stat.mockRejectedValue(new Error('not found'))
    toastMock.show.mockResolvedValue(undefined)
    shareMock.share.mockResolvedValue(undefined)
    documentSaverMock.saveFile.mockResolvedValue({ uri: 'content://saved-export' })
  })

  test('creates the nested cache path before downloading a URL fallback', async () => {
    const documentsError = Object.assign(new Error('Missing parent directory'), {
      code: 'OS-PLUG-FILE-0011',
    })
    filesystemMock.downloadFile
      .mockRejectedValueOnce(documentsError)
      .mockResolvedValueOnce({ path: '/cache/chatbox_temp_exports/image.png' })

    await new AndroidFilterWriter().exportByUrl('image.png', 'https://example.com/image.png')

    expect(filesystemMock.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        data: '',
        directory: 'CACHE',
        recursive: true,
      })
    )
    const preparedPath = filesystemMock.writeFile.mock.calls[0][0].path
    expect(preparedPath).toMatch(/^chatbox_temp_exports\/.+-image\.png$/)
    expect(filesystemMock.downloadFile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        directory: 'CACHE',
        path: preparedPath,
      })
    )
    expect(documentSaverMock.saveFile).toHaveBeenCalledWith({
      sourceUri: '/cache/chatbox_temp_exports/image.png',
      suggestedName: 'image.png',
      mimeType: 'image/png',
    })
    expect(toastMock.show).toHaveBeenCalledTimes(1)
    expect(toastMock.show).toHaveBeenCalledWith({ text: 'File saved to {{uri}}' })
    expect(filesystemMock.deleteFile).toHaveBeenCalledWith({ path: preparedPath, directory: 'CACHE' })
  })

  test('streams a large fallback to cache in bounded chunks', async () => {
    const firstChunk = 'a'.repeat(1024 * 1024)
    const finalChunk = 'tail'
    const dataCallback = async function* () {
      await Promise.resolve()
      yield firstChunk
      yield finalChunk
    }

    await new AndroidFilterWriter().exportStreamingFileWithSystemPicker('backup.json', dataCallback, 'application/json')

    expect(filesystemMock.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        data: firstChunk,
        directory: 'CACHE',
        encoding: 'utf8',
        recursive: true,
      })
    )
    const tempPath = filesystemMock.writeFile.mock.calls[0][0].path
    expect(filesystemMock.appendFile).toHaveBeenCalledWith({
      path: tempPath,
      data: finalChunk,
      directory: 'CACHE',
      encoding: 'utf8',
    })
    expect(documentSaverMock.saveFile).toHaveBeenCalledWith({
      sourceUri: 'cache://temporary-export',
      suggestedName: 'backup.json',
      mimeType: 'application/json',
    })
    expect(filesystemMock.deleteFile).toHaveBeenCalledWith({ path: tempPath, directory: 'CACHE' })
  })

  test('streams binary fallback data through the native bridge without building one file buffer', async () => {
    const dataCallback = async function* () {
      await Promise.resolve()
      yield new Uint8Array([0, 1, 2])
      yield new Uint8Array([3, 4])
    }

    await new AndroidFilterWriter().exportStreamingBinaryFileWithSystemPicker(
      'backup.zip',
      dataCallback,
      'application/zip'
    )

    const tempPath = filesystemMock.writeFile.mock.calls[0][0].path
    expect(filesystemMock.writeFile).toHaveBeenCalledWith({
      path: tempPath,
      data: 'AAECAwQ=',
      directory: 'CACHE',
      recursive: true,
    })
    expect(filesystemMock.appendFile).not.toHaveBeenCalled()
    expect(documentSaverMock.saveFile).toHaveBeenCalledWith({
      sourceUri: 'cache://temporary-export',
      suggestedName: 'backup.zip',
      mimeType: 'application/zip',
    })
    expect(filesystemMock.deleteFile).toHaveBeenCalledWith({ path: tempPath, directory: 'CACHE' })
  })

  test('uses the native cancellation code without hiding malformed success results', () => {
    expect(isSaveCanceledError({ code: 'SAVE_CANCELED', message: 'localized cancellation' })).toBe(true)
    expect(isSaveCanceledError({ code: 'MISSING_TARGET_URI', message: 'Save failed: missing target uri' })).toBe(false)
  })

  test('redacts paths and credentials from exported URL logs', () => {
    const url = 'https://user:password@example.com/private/image.png?token=secret#fragment'

    expect(getRedactedUrlForLog(url)).toBe('https://example.com')
    expect(getRedactedUrlForLog('not a url')).toBe('invalid-url')
  })
})

describe('MobileExporter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    filesystemMock.checkPermissions.mockResolvedValue({ publicStorage: 'granted' })
    filesystemMock.mkdir.mockResolvedValue(undefined)
    filesystemMock.writeFile.mockResolvedValue({ uri: 'file://saved-export' })
    filesystemMock.appendFile.mockResolvedValue(undefined)
    filesystemMock.deleteFile.mockResolvedValue(undefined)
    filesystemMock.getUri.mockResolvedValue({ uri: 'file://saved-export' })
    filesystemMock.stat.mockRejectedValue(new Error('not found'))
    toastMock.show.mockResolvedValue(undefined)
    shareMock.share.mockResolvedValue(undefined)
    documentSaverMock.saveFile.mockResolvedValue({ uri: 'content://saved-export' })
    buildPlatformMock.value = 'android'
  })

  test('does not leak an already-notified Android export failure to fire-and-forget callers', async () => {
    vi.spyOn(AndroidFilterWriter.prototype, 'exportTextFile').mockRejectedValueOnce(
      new HandledExportError(new Error('fallback failed'))
    )

    await expect(new MobileExporter().exportTextFile('export.txt', 'content')).resolves.toBeUndefined()
  })

  test('writes ZIP output in bounded binary chunks on Android', async () => {
    const first = new Uint8Array(1024 * 1024)
    const dataCallback = async function* () {
      await Promise.resolve()
      yield first
      yield new Uint8Array([1, 2, 3])
    }

    await expect(
      new MobileExporter().exportStreamingFile('backup.zip', dataCallback, 'application/zip')
    ).resolves.toEqual({ boundedMemory: true })

    expect(filesystemMock.writeFile.mock.calls[0][0].directory).toBe('CACHE')
    const writes = [...filesystemMock.writeFile.mock.calls, ...filesystemMock.appendFile.mock.calls]
    expect(writes).toHaveLength(5)
    expect(Math.max(...writes.map(([options]) => options.data.length))).toBeLessThanOrEqual(349528)
    expect(documentSaverMock.saveFile).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'application/zip' }))
    expect(filesystemMock.deleteFile).toHaveBeenCalled()
  })

  test('cleans up a small iOS ZIP using its auto-renamed path', async () => {
    buildPlatformMock.value = 'ios'
    filesystemMock.stat.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('not found'))
    const dataCallback = async function* () {
      await Promise.resolve()
      yield new Uint8Array([1, 2, 3])
    }

    await expect(
      new MobileExporter().exportStreamingFile('backup.zip', dataCallback, 'application/zip')
    ).resolves.toEqual({ boundedMemory: true, delivery: 'share-sheet' })

    expect(filesystemMock.writeFile).toHaveBeenCalledWith({
      path: 'backup_2.zip',
      data: 'AQID',
      directory: 'CACHE',
      recursive: false,
    })
    expect(filesystemMock.deleteFile).toHaveBeenCalledWith({ path: 'backup_2.zip', directory: 'CACHE' })
    expect(filesystemMock.deleteFile).not.toHaveBeenCalledWith({ path: 'backup.zip', directory: 'CACHE' })
  })

  test('cleans up a small iOS ZIP when sharing fails', async () => {
    buildPlatformMock.value = 'ios'
    shareMock.share.mockRejectedValueOnce(new Error('share failed'))
    const dataCallback = async function* () {
      await Promise.resolve()
      yield new Uint8Array([1, 2, 3])
    }

    await expect(
      new MobileExporter().exportStreamingFile('backup.zip', dataCallback, 'application/zip')
    ).rejects.toThrow('share failed')

    expect(filesystemMock.deleteFile).toHaveBeenCalledWith({ path: 'backup.zip', directory: 'CACHE' })
  })

  test('does not show a failure toast when the Android picker is aborted', async () => {
    documentSaverMock.saveFile.mockRejectedValueOnce(new DOMException('Operation canceled', 'AbortError'))
    const dataCallback = async function* () {
      await Promise.resolve()
      yield new Uint8Array([1, 2, 3])
    }

    await expect(
      new MobileExporter().exportStreamingFile('backup.zip', dataCallback, 'application/zip')
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(filesystemMock.deleteFile).toHaveBeenCalledWith({
      path: expect.stringContaining('backup.zip'),
      directory: 'CACHE',
    })
    expect(toastMock.show).not.toHaveBeenCalled()
  })
  test('cleans the Android cache and skips the picker when canceled after the last chunk', async () => {
    const controller = new AbortController()
    const dataCallback = async function* () {
      yield new Uint8Array([1, 2, 3])
      controller.abort(new DOMException('Canceled', 'AbortError'))
    }
    await expect(
      new MobileExporter().exportStreamingFile('backup.zip', dataCallback, 'application/zip', controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(documentSaverMock.saveFile).not.toHaveBeenCalled()
    expect(filesystemMock.deleteFile).toHaveBeenCalled()
  })

  test('does not replay a partially consumed archive after a native write failure', async () => {
    let starts = 0
    filesystemMock.appendFile.mockRejectedValueOnce(new Error('disk full'))
    const dataCallback = async function* () {
      starts++
      yield new Uint8Array(256 * 1024 + 1)
    }
    await expect(
      new MobileExporter().exportStreamingFile('backup.zip', dataCallback, 'application/zip')
    ).rejects.toThrow('disk full')
    expect(starts).toBe(1)
    expect(documentSaverMock.saveFile).not.toHaveBeenCalled()
    expect(filesystemMock.deleteFile).toHaveBeenCalled()
  })
})
