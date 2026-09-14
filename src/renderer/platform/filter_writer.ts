import { backupBinaryChunks } from './backup-binary-chunks'
import { Directory, Encoding, Filesystem, type WriteFileOptions, type WriteFileResult } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { Toast } from '@capacitor/toast'
import i18n from '@/i18n'
import { getLogger } from '@/lib/utils'
import { AndroidDocumentSaver } from './android_document_saver'

const log = getLogger('android-filter-writer')

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  csv: 'text/csv',
  html: 'text/html',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  json: 'application/json',
  md: 'text/markdown',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  zip: 'application/zip',
}

function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = []
  const chunkSize = 3 * 16_384
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))
    let binary = ''
    for (let index = 0; index < chunk.length; index++) binary += String.fromCharCode(chunk[index])
    parts.push(globalThis.btoa(binary))
  }
  return parts.join('')
}

function getMimeTypeForFilename(filename: string, fallback = '*/*'): string {
  const extension = filename.split('.').pop()?.toLowerCase()
  if (!extension) {
    return fallback
  }
  return MIME_TYPES_BY_EXTENSION[extension] || fallback
}

export function serializeErrorForLog(error: unknown) {
  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: string; cause?: unknown }
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: errorWithCode.code,
      cause: errorWithCode.cause ? String(errorWithCode.cause) : undefined,
    }
  }

  if (typeof error === 'string') {
    return { message: error }
  }

  if (error && typeof error === 'object') {
    try {
      return JSON.parse(JSON.stringify(error))
    } catch (_jsonError) {
      return { message: String(error) }
    }
  }

  return { message: String(error) }
}

export function getRedactedUrlForLog(url: string): string {
  try {
    const parsedUrl = new URL(url)
    return parsedUrl.origin === 'null' ? parsedUrl.protocol : parsedUrl.origin
  } catch (_error) {
    return 'invalid-url'
  }
}

export function isSaveCanceledError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    if (String((error as { code?: unknown }).code) === 'SAVE_CANCELED') {
      return true
    }
  }

  if (error instanceof Error) {
    return error.message === 'Save canceled'
  }

  if (typeof error === 'string') {
    return error === 'Save canceled'
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message) === 'Save canceled'
  }

  return false
}

export class HandledExportError extends Error {
  readonly originalError: unknown

  constructor(error: unknown) {
    super(error instanceof Error ? error.message : String(error))
    this.name = 'HandledExportError'
    this.originalError = error
  }
}

export function isHandledExportError(error: unknown): error is HandledExportError {
  return error instanceof HandledExportError
}

export function isDocumentsParentDirectoryError(error: unknown): boolean {
  const errorCode =
    error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : undefined
  const errorMessage =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message)
        : typeof error === 'string'
          ? error
          : ''

  return errorCode === 'OS-PLUG-FILE-0011' && errorMessage.includes('Missing parent directory')
}

export interface FileWriteConfig {
  path: string
  directory: Directory
  recursive?: boolean
  encoding?: Encoding
}

interface CacheTempFile {
  path: string
  uri: string
}

export abstract class FilterWriter {
  protected abstract getWriteConfig(filename: string): FileWriteConfig
  protected abstract handlePostWrite(result: WriteFileResult): Promise<void>
  protected abstract handleError(error: unknown): Promise<void>

  async checkOrRequestPermission?(): Promise<void> {
    // Default implementation - do nothing
  }

  async cleanupPartialExport(_filename: string, _actualPath?: string): Promise<void> {
    const config = this.getWriteConfig(_filename)
    try {
      await Filesystem.deleteFile({
        path: _actualPath || config.path,
        directory: config.directory,
      })
    } catch (_error) {
      // The file may not have been created yet.
    }
  }

  async writeFileAutoRenameOnConflict(options: WriteFileOptions): Promise<WriteFileResult> {
    const availablePath = await this.getAvailableFilePath(options)
    return await Filesystem.writeFile({ ...options, path: availablePath })
  }

  /**
   * Get an available file path that doesn't conflict with existing files.
   * If the file exists, append incrementing number (e.g., file_2.txt, file_3.txt)
   */
  protected async getAvailableFilePath(options: WriteFileOptions): Promise<string> {
    let counter = 1
    let currentPath = options.path

    while (true) {
      try {
        await Filesystem.stat({ ...options, path: currentPath })
        // File exists, try next increment
        const pathParts = options.path.split('.')
        const ext = pathParts.length > 1 ? pathParts.pop() : ''
        const baseName = pathParts.join('.')
        counter++
        currentPath = `${baseName}_${counter}${ext ? `.${ext}` : ''}`
      } catch (_e) {
        // File doesn't exist, we can use this path
        return currentPath
      }
    }
  }

  async exportBlob(filename: string, blob: Blob, encoding?: 'utf8' | 'ascii' | 'utf16') {
    try {
      const data = await blob.text()
      const config = this.getWriteConfig(filename)
      const result = await Filesystem.writeFile({
        path: config.path,
        data: data,
        directory: config.directory,
        encoding: encoding as Encoding,
        recursive: config.recursive,
      })
      await this.handlePostWrite(result)
    } catch (error) {
      await this.handleError(error)
    }
  }

  async exportTextFile(filename: string, content: string) {
    try {
      const config = this.getWriteConfig(filename)
      const result = await Filesystem.writeFile({
        path: config.path,
        data: content,
        directory: config.directory,
        encoding: Encoding.UTF8,
        recursive: config.recursive,
      })
      await this.handlePostWrite(result)
    } catch (error) {
      await this.handleError(error)
    }
  }

  async exportImageFile(basename: string, base64Data: string) {
    try {
      let type = ''
      let data = base64Data

      const base64Match = base64Data.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.*)$/)
      if (base64Match) {
        type = base64Match[1]
        data = base64Match[2]
      } else {
        type = 'image/png'
        data = base64Data
      }

      const ext = (type.split('/')[1] || 'png').split('+')[0]
      const filename = `${basename}.${ext}`
      const config = this.getWriteConfig(filename)

      const result = await Filesystem.writeFile({
        path: config.path,
        data: data,
        directory: config.directory,
        recursive: config.recursive,
      })
      await this.handlePostWrite(result)
    } catch (error) {
      await this.handleError(error)
    }
  }

  async exportByUrl(filename: string, url: string) {
    try {
      const config = this.getWriteConfig(filename)
      await this.ensureDirectoryExists(config)

      const file = await Filesystem.downloadFile({
        url: url,
        path: config.path,
        directory: config.directory,
        recursive: config.recursive,
      })
      await this.handlePostWrite({ uri: file.path || '' })
    } catch (error) {
      await this.handleError(error)
    }
  }

  async writeFirstChunk(filename: string, content: string): Promise<string> {
    const config = this.getWriteConfig(filename)
    await Filesystem.writeFile({
      path: config.path,
      data: content,
      directory: config.directory,
      encoding: Encoding.UTF8,
      recursive: config.recursive,
    })
    return config.path
  }

  async appendChunk(filename: string, content: string, actualPath?: string) {
    const config = this.getWriteConfig(filename)
    await Filesystem.appendFile({
      path: actualPath || config.path,
      data: content,
      directory: config.directory,
      encoding: Encoding.UTF8,
    })
  }

  async writeCompleteFile(filename: string, content: string) {
    const config = this.getWriteConfig(filename)
    const result = await Filesystem.writeFile({
      path: config.path,
      data: content,
      directory: config.directory,
      encoding: Encoding.UTF8,
      recursive: config.recursive,
    })
    await this.handlePostWrite(result)
  }

  async finishWriting(filename: string, content: string, actualPath?: string) {
    const config = this.getWriteConfig(filename)
    await Filesystem.appendFile({
      path: actualPath || config.path,
      data: content,
      directory: config.directory,
      encoding: Encoding.UTF8,
    })
    await this.completeExport(filename, actualPath)
  }

  async completeExport(filename: string, actualPath?: string) {
    const config = this.getWriteConfig(filename)
    const fileUri = await Filesystem.getUri({
      directory: config.directory,
      path: actualPath || config.path,
    })
    await this.handlePostWrite(fileUri)
  }

  async writeFirstBinaryChunk(filename: string, content: Uint8Array): Promise<string> {
    await this.checkOrRequestPermission?.()
    const config = this.getWriteConfig(filename)
    await this.ensureDirectoryExists(config)
    const availablePath = await this.getAvailableFilePath({
      path: config.path,
      data: '',
      directory: config.directory,
      recursive: config.recursive,
    })
    try {
      await Filesystem.writeFile({
        path: availablePath,
        data: bytesToBase64(content),
        directory: config.directory,
        recursive: config.recursive,
      })
    } catch (error) {
      await this.cleanupPartialExport(filename, availablePath)
      throw error
    }
    return availablePath
  }

  async appendBinaryChunk(filename: string, content: Uint8Array, actualPath?: string) {
    const config = this.getWriteConfig(filename)
    await Filesystem.appendFile({
      path: actualPath || config.path,
      data: bytesToBase64(content),
      directory: config.directory,
    })
  }

  async writeCompleteBinaryFile(filename: string, content: Uint8Array) {
    const actualPath = await this.writeFirstBinaryChunk(filename, content)
    await this.completeExport(filename, actualPath)
  }

  async finishBinaryWriting(filename: string, content: Uint8Array, actualPath?: string) {
    await this.appendBinaryChunk(filename, content, actualPath)
    await this.completeExport(filename, actualPath)
  }

  protected async ensureDirectoryExists(config: FileWriteConfig) {
    if (config.recursive) {
      const dirPath = config.path.split('/').slice(0, -1).join('/')
      if (dirPath) {
        try {
          await Filesystem.mkdir({
            path: dirPath,
            directory: config.directory,
            recursive: true,
          })
        } catch (_e) {
          // Directory already exists — safe to ignore on Android
        }
      }
    }
  }
}

export class IOSFilterWriter extends FilterWriter {
  protected getWriteConfig(filename: string): FileWriteConfig {
    return {
      path: filename,
      directory: Directory.Cache,
      recursive: false,
    }
  }

  protected async handlePostWrite(result: WriteFileResult): Promise<void> {
    await Share.share({
      title: i18n.t('Share File') || 'Share File',
      text: i18n.t('Share File') || 'Share File',
      url: result.uri,
      dialogTitle: i18n.t('Share File') || 'Share File',
    })
  }

  protected handleError(error: unknown): Promise<never> {
    return Promise.reject(error)
  }

  async exportTextFile(filename: string, content: string) {
    const config = this.getWriteConfig(filename)
    const result = await Filesystem.writeFile({
      path: config.path,
      data: content,
      directory: config.directory,
      encoding: Encoding.UTF8,
    })
    await this.handlePostWrite(result)
  }

  async writeCompleteFile(filename: string, content: string) {
    const config = this.getWriteConfig(filename)
    const result = await Filesystem.writeFile({
      path: config.path,
      data: content,
      directory: config.directory,
      encoding: Encoding.UTF8,
    })
    await this.handlePostWrite(result)
  }
}

export class AndroidFilterWriter extends FilterWriter {
  protected getWriteConfig(filename: string): FileWriteConfig {
    return {
      path: `chatbox_ai_exports/${filename}`,
      directory: Directory.Documents,
      recursive: true,
    }
  }

  protected async handlePostWrite(result: WriteFileResult): Promise<void> {
    log.info('handlePostWrite', { uri: result.uri })
    try {
      await Toast.show({ text: i18n.t('File saved to {{uri}}', { uri: result.uri }) })
    } catch (error) {
      log.warn('handlePostWrite:toastFailed', { uri: result.uri, error: serializeErrorForLog(error) })
    }
  }

  protected async handleError(error: unknown): Promise<never> {
    log.error('handleError', serializeErrorForLog(error))
    try {
      await Toast.show({
        text: i18n.t('Failed to save file: {{error}}', {
          error: error instanceof Error ? error.message : String(error),
        }),
      })
    } catch (toastError) {
      log.warn('handleError:toastFailed', { error: serializeErrorForLog(toastError) })
    }
    throw new HandledExportError(error)
  }

  async checkOrRequestPermission(): Promise<void> {
    log.info('checkOrRequestPermission:start')
    let result = await Filesystem.checkPermissions()
    log.info('checkOrRequestPermission:checked', result)
    if (result.publicStorage === 'granted') {
      return
    }
    result = await Filesystem.requestPermissions()
    log.info('checkOrRequestPermission:requested', result)
    if (result.publicStorage === 'denied') {
      await Toast.show({ text: i18n.t('No permission to write file') })
    }
  }

  async exportTextFileWithSystemPicker(filename: string, content: string, mimeType?: string) {
    log.warn('exportTextFileWithSystemPicker:start', { filename, mimeType, contentLength: content.length })
    const tempFile = await this.writeTextToCache(filename, content)
    log.warn('exportTextFileWithSystemPicker:tempWritten', { uri: tempFile.uri, path: tempFile.path })
    try {
      const saveResult = await AndroidDocumentSaver.saveFile({
        sourceUri: tempFile.uri,
        suggestedName: filename,
        mimeType: mimeType || getMimeTypeForFilename(filename, 'text/plain'),
      })
      log.warn('exportTextFileWithSystemPicker:pickerSaved', saveResult)
      await this.handlePostWrite({ uri: saveResult.uri })
    } finally {
      await this.cleanupCacheTempFile(tempFile.path, filename)
    }
  }

  async exportStreamingFileWithSystemPicker(
    filename: string,
    dataCallback: () => AsyncGenerator<string, void, unknown>,
    mimeType = 'application/json'
  ) {
    const tempPath = this.getCachePath(filename)
    const chunkSize = 1024 * 1024
    let tempUri: string | undefined
    let bufferedContent = ''
    let chunkCount = 0
    let totalLength = 0

    log.warn('exportStreamingFileWithSystemPicker:start', { filename, mimeType, chunkSize })

    const flush = async () => {
      if (!bufferedContent && tempUri) {
        return
      }

      const content = bufferedContent
      bufferedContent = ''
      totalLength += content.length
      chunkCount++

      if (!tempUri) {
        const result = await Filesystem.writeFile({
          path: tempPath,
          data: content,
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
          recursive: true,
        })
        tempUri = result.uri
        return
      }

      await Filesystem.appendFile({
        path: tempPath,
        data: content,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      })
    }

    try {
      for await (const chunk of dataCallback()) {
        bufferedContent += chunk
        if (bufferedContent.length >= chunkSize) {
          await flush()
        }
      }

      if (bufferedContent || !tempUri) {
        await flush()
      }

      if (!tempUri) {
        throw new Error('Failed to create temporary export file')
      }

      log.warn('exportStreamingFileWithSystemPicker:tempWritten', {
        filename,
        path: tempPath,
        uri: tempUri,
        chunkCount,
        totalLength,
      })

      const saveResult = await AndroidDocumentSaver.saveFile({
        sourceUri: tempUri,
        suggestedName: filename,
        mimeType,
      })
      log.warn('exportStreamingFileWithSystemPicker:pickerSaved', saveResult)
      await this.handlePostWrite({ uri: saveResult.uri })
    } finally {
      await this.cleanupCacheTempFile(tempPath, filename)
    }
  }

  async exportStreamingBinaryFileWithSystemPicker(
    filename: string,
    dataCallback: () => AsyncGenerator<Uint8Array, void, unknown>,
    mimeType = 'application/octet-stream',
    signal?: AbortSignal
  ) {
    const tempPath = this.getCachePath(filename)
    let tempUri: string | undefined
    let wroteAnyChunk = false
    try {
      for await (const chunk of backupBinaryChunks(dataCallback(), signal)) {
        if (signal?.aborted) throw signal.reason ?? new DOMException('Operation canceled', 'AbortError')
        if (!wroteAnyChunk) {
          const result = await Filesystem.writeFile({
            path: tempPath,
            data: bytesToBase64(chunk),
            directory: Directory.Cache,
            recursive: true,
          })
          tempUri = result.uri
          wroteAnyChunk = true
        } else {
          await Filesystem.appendFile({
            path: tempPath,
            data: bytesToBase64(chunk),
            directory: Directory.Cache,
          })
        }
      }
      if (!tempUri) {
        const result = await Filesystem.writeFile({
          path: tempPath,
          data: '',
          directory: Directory.Cache,
          recursive: true,
        })
        tempUri = result.uri
      }
      signal?.throwIfAborted()
      const saveResult = await AndroidDocumentSaver.saveFile({ sourceUri: tempUri, suggestedName: filename, mimeType })
      await this.handlePostWrite({ uri: saveResult.uri })
    } finally {
      await this.cleanupCacheTempFile(tempPath, filename)
    }
  }

  async exportBlob(filename: string, blob: Blob, encoding?: 'utf8' | 'ascii' | 'utf16') {
    const data = await blob.text()
    try {
      log.info('exportBlob:documentsAttempt', { filename, encoding, blobType: blob.type, contentLength: data.length })
      await this.checkOrRequestPermission()
      const result = await this.writeTextToDocuments(filename, data, encoding as Encoding | undefined)
      await this.handlePostWrite(result)
    } catch (error) {
      log.warn('exportBlob:documentsFailed', {
        filename,
        stage: 'documents-write',
        error: serializeErrorForLog(error),
      })
      try {
        log.warn('exportBlob:fallbackPicker:start', { filename, stage: 'fallback-cache-then-picker' })
        await this.exportTextFileWithSystemPicker(filename, data, blob.type || getMimeTypeForFilename(filename))
        log.warn('exportBlob:fallbackPicker:success', { filename, stage: 'fallback-cache-then-picker' })
      } catch (fallbackError) {
        if (isSaveCanceledError(fallbackError)) {
          log.info('exportBlob:fallbackPicker:canceled', {
            filename,
            stage: 'fallback-cache-then-picker',
            error: serializeErrorForLog(fallbackError),
          })
          throw fallbackError
        }
        log.error('exportBlob:fallbackPicker:failed', {
          filename,
          stage: 'fallback-cache-then-picker',
          error: serializeErrorForLog(fallbackError),
        })
        await this.handleError(fallbackError)
      }
    }
  }

  async exportTextFile(filename: string, content: string) {
    try {
      log.info('exportTextFile:documentsAttempt', { filename, contentLength: content.length })
      await this.checkOrRequestPermission()
      const result = await this.writeTextToDocuments(filename, content, Encoding.UTF8)
      await this.handlePostWrite(result)
    } catch (error) {
      log.warn('exportTextFile:documentsFailed', {
        filename,
        stage: 'documents-write',
        error: serializeErrorForLog(error),
      })
      try {
        log.warn('exportTextFile:fallbackPicker:start', { filename, stage: 'fallback-cache-then-picker' })
        await this.exportTextFileWithSystemPicker(filename, content)
        log.warn('exportTextFile:fallbackPicker:success', { filename, stage: 'fallback-cache-then-picker' })
      } catch (fallbackError) {
        if (isSaveCanceledError(fallbackError)) {
          log.info('exportTextFile:fallbackPicker:canceled', {
            filename,
            stage: 'fallback-cache-then-picker',
            error: serializeErrorForLog(fallbackError),
          })
          throw fallbackError
        }
        log.error('exportTextFile:fallbackFailed', {
          filename,
          stage: 'fallback-cache-then-picker',
          fallbackError: serializeErrorForLog(fallbackError),
          originalError: serializeErrorForLog(error),
        })
        await this.handleError(fallbackError || error)
      }
    }
  }

  async exportImageFile(basename: string, base64Data: string) {
    let type = ''
    let data = base64Data

    const base64Match = base64Data.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.*)$/)
    if (base64Match) {
      type = base64Match[1]
      data = base64Match[2]
    } else {
      type = 'image/png'
    }

    const ext = (type.split('/')[1] || 'png').split('+')[0]
    const filename = `${basename}.${ext}`

    try {
      log.info('exportImageFile:documentsAttempt', { filename, mimeType: type, dataLength: data.length })
      await this.checkOrRequestPermission()
      const result = await this.writeBinaryToDocuments(filename, data)
      await this.handlePostWrite(result)
    } catch (error) {
      log.warn('exportImageFile:documentsFailed', {
        filename,
        stage: 'documents-write',
        error: serializeErrorForLog(error),
      })
      try {
        log.warn('exportImageFile:fallbackCacheWrite:start', { filename, stage: 'fallback-cache-write' })
        const tempFile = await this.writeBinaryToCache(filename, data)
        log.warn('exportImageFile:tempWritten', { uri: tempFile.uri, path: tempFile.path })
        try {
          log.warn('exportImageFile:fallbackPicker:start', { filename, stage: 'fallback-picker-copy' })
          const saveResult = await AndroidDocumentSaver.saveFile({
            sourceUri: tempFile.uri,
            suggestedName: filename,
            mimeType: type,
          })
          log.warn('exportImageFile:pickerSaved', saveResult)
          await this.handlePostWrite({ uri: saveResult.uri })
        } finally {
          await this.cleanupCacheTempFile(tempFile.path, filename)
        }
      } catch (fallbackError) {
        if (isSaveCanceledError(fallbackError)) {
          log.info('exportImageFile:fallbackCanceled', {
            filename,
            stage: 'fallback-cache-or-picker',
            error: serializeErrorForLog(fallbackError),
          })
          throw fallbackError
        }
        log.error('exportImageFile:fallbackFailed', {
          filename,
          stage: 'fallback-cache-or-picker',
          error: serializeErrorForLog(fallbackError),
        })
        await this.handleError(fallbackError)
      }
    }
  }

  async exportByUrl(filename: string, url: string) {
    const urlOrigin = getRedactedUrlForLog(url)
    try {
      log.info('exportByUrl:documentsAttempt', { filename, urlOrigin })
      await this.checkOrRequestPermission()
      const config = this.getWriteConfig(filename)
      await this.ensureDirectoryExists(config)
      const file = await Filesystem.downloadFile({
        url,
        path: config.path,
        directory: config.directory,
        recursive: config.recursive,
      })
      await this.handlePostWrite({ uri: file.path || '' })
      return
    } catch (error) {
      log.warn('exportByUrl:documentsFailed', {
        filename,
        urlOrigin,
        stage: 'documents-download',
        error: serializeErrorForLog(error),
      })
      try {
        log.warn('exportByUrl:fallbackCacheDownload:start', {
          filename,
          urlOrigin,
          stage: 'fallback-cache-download',
        })
        const tempPath = this.getCachePath(filename)
        try {
          const preparedFile = await this.prepareCacheDownloadPath(tempPath)
          const tempResult = await Filesystem.downloadFile({
            url,
            path: tempPath,
            directory: Directory.Cache,
          })
          log.warn('exportByUrl:tempDownloaded', { ...tempResult, tempPath })
          log.warn('exportByUrl:fallbackPicker:start', { filename, stage: 'fallback-picker-copy' })
          const saveResult = await AndroidDocumentSaver.saveFile({
            sourceUri: tempResult.path || preparedFile.uri,
            suggestedName: filename,
            mimeType: getMimeTypeForFilename(filename),
          })
          log.warn('exportByUrl:pickerSaved', saveResult)
          await this.handlePostWrite({ uri: saveResult.uri })
        } finally {
          await this.cleanupCacheTempFile(tempPath, filename)
        }
      } catch (fallbackError) {
        if (isSaveCanceledError(fallbackError)) {
          log.info('exportByUrl:fallbackCanceled', {
            filename,
            urlOrigin,
            stage: 'fallback-cache-or-picker',
            error: serializeErrorForLog(fallbackError),
          })
          throw fallbackError
        }
        log.error('exportByUrl:fallbackFailed', {
          filename,
          urlOrigin,
          stage: 'fallback-cache-or-picker',
          error: serializeErrorForLog(fallbackError),
        })
        await this.handleError(fallbackError)
      }
    }
  }

  async writeFirstChunk(filename: string, content: string): Promise<string> {
    log.info('writeFirstChunk:start', { filename, contentLength: content.length })
    await this.checkOrRequestPermission()
    const config = this.getWriteConfig(filename)
    const availablePath = await this.getRetryableAvailablePath(config, content)
    log.info('writeFirstChunk:resolvedPath', { filename, availablePath })
    await Filesystem.writeFile({
      path: availablePath,
      data: content,
      directory: config.directory,
      encoding: Encoding.UTF8,
      recursive: config.recursive,
    })
    return availablePath
  }

  async writeCompleteFile(filename: string, content: string) {
    log.info('writeCompleteFile:start', { filename, contentLength: content.length })
    await this.checkOrRequestPermission()
    const result = await this.writeTextToDocuments(filename, content, Encoding.UTF8)
    await this.handlePostWrite(result)
  }

  async cleanupPartialExport(filename: string, actualPath?: string): Promise<void> {
    const config = this.getWriteConfig(filename)
    const path = actualPath || config.path
    try {
      log.warn('cleanupPartialExport:start', { filename, path })
      await Filesystem.deleteFile({
        path,
        directory: config.directory,
      })
      log.warn('cleanupPartialExport:success', { filename, path })
    } catch (error) {
      log.warn('cleanupPartialExport:skipped', { filename, path, error })
    }
  }

  private writeTextToDocuments(filename: string, content: string, encoding?: Encoding): Promise<WriteFileResult> {
    const config = this.getWriteConfig(filename)
    return this.writeToDocuments({
      path: config.path,
      data: content,
      directory: config.directory,
      encoding,
      recursive: config.recursive,
    })
  }

  private writeBinaryToDocuments(filename: string, data: string): Promise<WriteFileResult> {
    const config = this.getWriteConfig(filename)
    return this.writeToDocuments({
      path: config.path,
      data,
      directory: config.directory,
      recursive: config.recursive,
    })
  }

  private async writeToDocuments(options: WriteFileOptions): Promise<WriteFileResult> {
    try {
      log.info('writeToDocuments:firstAttempt', {
        path: options.path,
        directory: options.directory,
        recursive: options.recursive,
      })
      const result = await this.writeFileAutoRenameOnConflict(options)
      log.info('writeToDocuments:firstAttempt:success', {
        path: options.path,
        directory: options.directory,
        uri: result.uri,
      })
      return result
    } catch (error) {
      log.warn('writeToDocuments:firstAttemptFailed', {
        path: options.path,
        directory: options.directory,
        recursive: options.recursive,
        stage: 'documents-first-attempt',
        error: serializeErrorForLog(error),
      })
      if (isDocumentsParentDirectoryError(error)) {
        throw error
      }
      await this.ensureDirectoryExists({
        path: options.path,
        directory: options.directory || Directory.Documents,
        recursive: options.recursive,
      })
      log.warn('writeToDocuments:retryAfterMkdir', {
        path: options.path,
        directory: options.directory,
        recursive: options.recursive,
      })
      const result = await this.writeFileAutoRenameOnConflict(options)
      log.info('writeToDocuments:retryAfterMkdir:success', {
        path: options.path,
        directory: options.directory,
        uri: result.uri,
      })
      return result
    }
  }

  private async getRetryableAvailablePath(config: FileWriteConfig, content: string): Promise<string> {
    try {
      log.info('getRetryableAvailablePath:firstAttempt', { path: config.path, directory: config.directory })
      return await this.getAvailableFilePath({
        path: config.path,
        data: content,
        directory: config.directory,
        recursive: config.recursive,
      })
    } catch (error) {
      log.warn('getRetryableAvailablePath:firstAttemptFailed', {
        path: config.path,
        directory: config.directory,
        error: serializeErrorForLog(error),
      })
      await this.ensureDirectoryExists(config)
      log.warn('getRetryableAvailablePath:retryAfterMkdir', { path: config.path, directory: config.directory })
      return await this.getAvailableFilePath({
        path: config.path,
        data: content,
        directory: config.directory,
        recursive: config.recursive,
      })
    }
  }

  private getCachePath(filename: string): string {
    return `chatbox_temp_exports/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${filename}`
  }

  private prepareCacheDownloadPath(path: string): Promise<WriteFileResult> {
    return Filesystem.writeFile({
      path,
      data: '',
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
      recursive: true,
    })
  }

  private async writeTextToCache(filename: string, content: string): Promise<CacheTempFile> {
    const path = this.getCachePath(filename)
    const result = await Filesystem.writeFile({
      path,
      data: content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
      recursive: true,
    })
    log.info('writeTextToCache:success', { filename, uri: result.uri, contentLength: content.length })
    return { path, uri: result.uri }
  }

  private async writeBinaryToCache(filename: string, data: string): Promise<CacheTempFile> {
    const path = this.getCachePath(filename)
    const result = await Filesystem.writeFile({
      path,
      data,
      directory: Directory.Cache,
      recursive: true,
    })
    log.info('writeBinaryToCache:success', { filename, uri: result.uri, dataLength: data.length })
    return { path, uri: result.uri }
  }

  private async cleanupCacheTempFile(path: string, filename: string): Promise<void> {
    try {
      await Filesystem.deleteFile({
        path,
        directory: Directory.Cache,
      })
      log.info('cleanupCacheTempFile:success', { filename, path })
    } catch (error) {
      log.warn('cleanupCacheTempFile:skipped', {
        filename,
        path,
        error: serializeErrorForLog(error),
      })
    }
  }
}
