import { binaryChunks } from './binary-chunks'
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
      for await (const chunk of binaryChunks(dataCallback(), signal)) {
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
}
