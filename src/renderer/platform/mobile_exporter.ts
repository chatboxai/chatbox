import { backupBinaryChunks } from './backup-binary-chunks'
import type { WriteFileOptions, WriteFileResult } from '@capacitor/filesystem'
import { Toast } from '@capacitor/toast'
import i18n from '@/i18n'
import { getLogger } from '@/lib/utils'
import { CHATBOX_BUILD_PLATFORM } from '@/variables'
import {
  AndroidFilterWriter,
  type FilterWriter,
  getRedactedUrlForLog,
  IOSFilterWriter,
  isHandledExportError,
  isSaveCanceledError,
  serializeErrorForLog,
} from './filter_writer'
import type { Exporter, StreamingExportResult } from './interfaces'

const log = getLogger('mobile_exporter')

export default class MobileExporter implements Exporter {
  private writer: FilterWriter

  constructor() {
    const platform = CHATBOX_BUILD_PLATFORM
    this.writer = platform === 'ios' ? new IOSFilterWriter() : new AndroidFilterWriter()
  }

  async writeFileAutoRenameOnConflict(options: WriteFileOptions): Promise<WriteFileResult> {
    log.info('writeFileAutoRenameOnConflict called', { path: options.path, directory: options.directory })
    try {
      const result = await this.writer.writeFileAutoRenameOnConflict(options)
      log.info('writeFileAutoRenameOnConflict success', { uri: result.uri })
      return result
    } catch (error) {
      log.error('writeFileAutoRenameOnConflict failed', {
        path: options.path,
        error: serializeErrorForLog(error),
      })
      throw error
    }
  }

  async exportBlob(filename: string, blob: Blob, encoding?: 'utf8' | 'ascii' | 'utf16') {
    log.info('exportBlob called', { filename, blobSize: blob.size, blobType: blob.type, encoding })
    try {
      await this.writer.exportBlob(filename, blob, encoding)
      log.info('exportBlob success', { filename })
    } catch (error) {
      if (isSaveCanceledError(error)) {
        log.info('exportBlob canceled', { filename, error: serializeErrorForLog(error) })
        return
      }
      if (isHandledExportError(error)) {
        log.info('exportBlob failed after showing an error', {
          filename,
          error: serializeErrorForLog(error.originalError),
        })
        return
      }
      log.error('exportBlob failed', { filename, error: serializeErrorForLog(error) })
      throw error
    }
  }

  async exportTextFile(filename: string, content: string) {
    log.info('exportTextFile called', { filename, contentLength: content.length })
    try {
      await this.writer.exportTextFile(filename, content)
      log.info('exportTextFile success', { filename })
    } catch (error) {
      if (isSaveCanceledError(error)) {
        log.info('exportTextFile canceled', { filename, error: serializeErrorForLog(error) })
        return
      }
      if (isHandledExportError(error)) {
        log.info('exportTextFile failed after showing an error', {
          filename,
          error: serializeErrorForLog(error.originalError),
        })
        return
      }
      log.error('exportTextFile failed', { filename, error: serializeErrorForLog(error) })
      throw error
    }
  }

  async exportImageFile(basename: string, base64Data: string) {
    log.info('exportImageFile called', { basename, dataLength: base64Data.length })
    try {
      await this.writer.exportImageFile(basename, base64Data)
      log.info('exportImageFile success', { basename })
    } catch (error) {
      if (isSaveCanceledError(error)) {
        log.info('exportImageFile canceled', { basename, error: serializeErrorForLog(error) })
        return
      }
      if (isHandledExportError(error)) {
        log.info('exportImageFile failed after showing an error', {
          basename,
          error: serializeErrorForLog(error.originalError),
        })
        return
      }
      log.error('exportImageFile failed', { basename, error: serializeErrorForLog(error) })
      throw error
    }
  }

  async exportByUrl(filename: string, url: string) {
    const urlOrigin = getRedactedUrlForLog(url)
    log.info('exportByUrl called', { filename, urlOrigin })
    try {
      await this.writer.exportByUrl(filename, url)
      log.info('exportByUrl success', { filename })
    } catch (error) {
      if (isSaveCanceledError(error)) {
        log.info('exportByUrl canceled', {
          filename,
          urlOrigin,
          error: serializeErrorForLog(error),
        })
        return
      }
      if (isHandledExportError(error)) {
        log.info('exportByUrl failed after showing an error', {
          filename,
          urlOrigin,
          error: serializeErrorForLog(error.originalError),
        })
        return
      }
      log.error('exportByUrl failed', {
        filename,
        urlOrigin,
        error: serializeErrorForLog(error),
      })
      throw error
    }
  }

  async exportStreamingJson(filename: string, dataCallback: () => AsyncGenerator<string, void, unknown>) {
    log.info('exportStreamingJson started', { filename })

    if (this.writer instanceof AndroidFilterWriter) {
      try {
        await this.writeStreamingContent(filename, dataCallback)
        log.info('exportStreamingJson completed via Android streaming path', { filename })
        return
      } catch (error) {
        log.warn('exportStreamingJson:androidStreamingFailed', {
          filename,
          stage: 'documents-streaming-write',
          error: serializeErrorForLog(error),
        })
        try {
          log.warn('exportStreamingJson:fallbackCacheStream:start', {
            filename,
            stage: 'fallback-stream-to-cache',
          })
          await this.writer.exportStreamingFileWithSystemPicker(filename, dataCallback, 'application/json')
          log.info('exportStreamingJson completed via Android streaming cache fallback', { filename })
          return
        } catch (fallbackError) {
          if (isSaveCanceledError(fallbackError)) {
            log.info('exportStreamingJson canceled during Android streaming cache fallback', {
              filename,
              stage: 'fallback-stream-to-cache',
              error: serializeErrorForLog(fallbackError),
            })
            return
          }
          log.error('exportStreamingJson failed on Android streaming cache fallback', {
            filename,
            stage: 'fallback-stream-to-cache',
            error: serializeErrorForLog(fallbackError),
          })
          await Toast.show({
            text: i18n.t('Failed to export file: {{error}}', { error: fallbackError }),
          })
          throw fallbackError
        }
      }
    }

    try {
      await this.writeStreamingContent(filename, dataCallback)
      log.info('exportStreamingJson completed', { filename })
    } catch (error) {
      log.error('exportStreamingJson failed', {
        filename,
        stage: 'streaming-write',
        error: serializeErrorForLog(error),
      })
      await Toast.show({
        text: i18n.t('Failed to export file: {{error}}', { error: error }),
      })
      throw error
    }
  }

  async exportStreamingFile(
    filename: string,
    dataCallback: () => AsyncGenerator<Uint8Array, void, unknown>,
    mimeType: string,
    signal?: AbortSignal
  ): Promise<StreamingExportResult> {
    try {
      if (this.writer instanceof AndroidFilterWriter) {
        await this.writer.exportStreamingBinaryFileWithSystemPicker(filename, dataCallback, mimeType, signal)
        return { boundedMemory: true }
      }
      await this.writeStreamingBinaryContent(filename, dataCallback, signal)
      return { boundedMemory: true, delivery: 'share-sheet' }
    } catch (error) {
      if (signal?.aborted)
        throw signal.reason instanceof Error ? signal.reason : new DOMException('Operation canceled', 'AbortError')
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      if (isSaveCanceledError(error)) throw new DOMException('Operation canceled', 'AbortError')
      await Toast.show({ text: i18n.t('Failed to export file: {{error}}', { error }) })
      throw error
    }
  }

  private async writeStreamingBinaryContent(
    filename: string,
    dataCallback: () => AsyncGenerator<Uint8Array, void, unknown>,
    signal?: AbortSignal
  ) {
    let actualPath: string | undefined
    try {
      for await (const chunk of backupBinaryChunks(dataCallback(), signal)) {
        if (actualPath === undefined) actualPath = await this.writer.writeFirstBinaryChunk(filename, chunk)
        else await this.writer.appendBinaryChunk(filename, chunk, actualPath)
      }
      signal?.throwIfAborted()
      if (actualPath === undefined) actualPath = await this.writer.writeFirstBinaryChunk(filename, new Uint8Array())
      signal?.throwIfAborted()
      await this.writer.completeExport(filename, actualPath)
    } finally {
      if (actualPath !== undefined) await this.writer.cleanupPartialExport(filename, actualPath)
    }
  }

  private async writeStreamingContent(filename: string, dataCallback: () => AsyncGenerator<string, void, unknown>) {
    let tempContent = ''
    let isFirstWrite = true
    let chunkCount = 0
    let totalBytesWritten = 0
    let actualPath: string | undefined // Track the actual file path (may differ if renamed on conflict)
    const generator = dataCallback()
    const CHUNK_SIZE = 1024 * 1024 // 1MB chunks

    log.debug('writeStreamingContent started', { filename, chunkSize: CHUNK_SIZE })

    try {
      for await (const chunk of generator) {
        tempContent += chunk
        // 如果内容太长，分批写入文件
        if (tempContent.length > CHUNK_SIZE) {
          chunkCount++
          totalBytesWritten += tempContent.length
          if (isFirstWrite) {
            // 第一次写入创建文件，获取实际路径
            log.info('writeStreamingContent:firstChunk:start', {
              filename,
              chunkIndex: chunkCount,
              chunkLength: tempContent.length,
            })
            actualPath = await this.writeFirstChunk(filename, tempContent)
            log.info('writeStreamingContent:firstChunk:success', {
              filename,
              chunkIndex: chunkCount,
              chunkLength: tempContent.length,
              actualPath,
            })
            isFirstWrite = false
          } else {
            // 后续写入追加内容，使用实际路径
            log.info('writeStreamingContent:appendChunk:start', {
              filename,
              chunkIndex: chunkCount,
              chunkLength: tempContent.length,
              actualPath,
            })
            await this.appendChunk(filename, tempContent, actualPath)
            log.info('writeStreamingContent:appendChunk:success', {
              filename,
              chunkIndex: chunkCount,
              chunkLength: tempContent.length,
              actualPath,
            })
          }
          tempContent = ''
        }
      }

      // 写入剩余内容
      if (tempContent.length > 0) {
        totalBytesWritten += tempContent.length
        if (isFirstWrite) {
          // 如果所有内容都小于1MB，直接创建完整文件
          log.info('writeStreamingContent:writeCompleteFile:start', {
            filename,
            contentLength: tempContent.length,
          })
          await this.writeCompleteFile(filename, tempContent)
          log.info('writeStreamingContent:writeCompleteFile:success', {
            filename,
            contentLength: tempContent.length,
          })
        } else {
          // 追加最后一块内容并完成，使用实际路径
          chunkCount++
          log.info('writeStreamingContent:finishWriting:start', {
            filename,
            chunkIndex: chunkCount,
            chunkLength: tempContent.length,
            actualPath,
          })
          await this.finishWriting(filename, tempContent, actualPath)
          log.info('writeStreamingContent:finishWriting:success', {
            filename,
            chunkIndex: chunkCount,
            chunkLength: tempContent.length,
            actualPath,
          })
        }
      } else if (!isFirstWrite) {
        // 没有剩余内容但之前已经写入过，需要完成操作
        log.info('writeStreamingContent:completeExport:start', {
          filename,
          actualPath,
        })
        await this.completeExport(filename, actualPath)
        log.info('writeStreamingContent:completeExport:success', {
          filename,
          actualPath,
        })
      }

      log.info('writeStreamingContent finished', { filename, actualPath, totalChunks: chunkCount, totalBytesWritten })
    } catch (error) {
      log.warn('writeStreamingContent failed, cleaning up partial export if needed', {
        filename,
        actualPath,
        isFirstWrite,
        chunkCount,
        totalBytesWritten,
        error: serializeErrorForLog(error),
      })
      if (!isFirstWrite || actualPath) {
        await this.writer.cleanupPartialExport(filename, actualPath)
      }
      throw error
    }
  }

  private async writeFirstChunk(filename: string, content: string): Promise<string> {
    return await this.writer.writeFirstChunk(filename, content)
  }

  private async appendChunk(filename: string, content: string, actualPath?: string) {
    await this.writer.appendChunk(filename, content, actualPath)
  }

  private async writeCompleteFile(filename: string, content: string) {
    await this.writer.writeCompleteFile(filename, content)
  }

  private async finishWriting(filename: string, content: string, actualPath?: string) {
    await this.writer.finishWriting(filename, content, actualPath)
  }

  private async completeExport(filename: string, actualPath?: string) {
    await this.writer.completeExport(filename, actualPath)
  }
}
