import { isTextFilePath } from '../../file-extensions'
import type { BlobStoragePort, KeyValueStoragePort, LoggerPort } from '../../ports'
import type {
  AttachmentAnalysisPort,
  AttachmentParserPort,
  AttachmentPreparationOptions,
  PickedAsset,
  PickedAssetContentPort,
  PreparedAttachment,
} from './attachment-types'

export interface AttachmentServiceDependencies {
  blobs: Pick<BlobStoragePort, 'get' | 'set'>
  metadata: Pick<KeyValueStoragePort, 'get' | 'set'>
  content: PickedAssetContentPort
  parser: AttachmentParserPort
  analysis: AttachmentAnalysisPort
  logger?: LoggerPort
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Encode bytes without relying on DOM btoa or Node Buffer. The implementation
 * is intentionally small so it executes unchanged in browsers and Hermes.
 */
export function encodeBase64(bytes: Uint8Array): string {
  let result = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0)

    result += BASE64_ALPHABET[(combined >> 18) & 63]
    result += BASE64_ALPHABET[(combined >> 12) & 63]
    result += second === undefined ? '=' : BASE64_ALPHABET[(combined >> 6) & 63]
    result += third === undefined ? '=' : BASE64_ALPHABET[combined & 63]
  }
  return result
}

/**
 * Portable attachment preparation orchestration.
 *
 * Parsing policy and platform file access are injected. This service owns the
 * historical cache keys, raw binary persistence and metadata persistence.
 */
export class AttachmentService {
  constructor(private readonly dependencies: AttachmentServiceDependencies) {}

  async prepare(asset: PickedAsset, options: AttachmentPreparationOptions = {}): Promise<PreparedAttachment> {
    try {
      return await this.prepareOrThrow(asset, options)
    } catch (error) {
      await this.dependencies.logger?.log('error', `Failed to preprocess attachment "${asset.name}"`, { error })
      return {
        asset,
        content: '',
        storageKey: '',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Prepare an attachment while preserving the original failure for hosts that
   * implement reporting or storage-quota recovery at the composition boundary.
   */
  async prepareOrThrow(asset: PickedAsset, options: AttachmentPreparationOptions = {}): Promise<PreparedAttachment> {
    const storageKey = asset.id
    const rawStorageKey = `${storageKey}_raw`
    const isText = isTextFilePath(asset.name)

    const existingContent = await this.dependencies.blobs.get(storageKey).catch(() => null)
    if (existingContent?.trim()) {
      const existingTokenCountMap =
        (await this.dependencies.metadata.get<Record<string, number>>(`${storageKey}_tokenMap`).catch(() => null)) ?? {}
      const parserType =
        (await this.dependencies.metadata.get<string>(`${storageKey}_parserType`).catch(() => null)) ?? undefined
      const analysis = await this.dependencies.analysis.analyze({
        asset,
        content: existingContent,
        parserType,
        existingTokenCountMap,
      })
      await this.dependencies.metadata.set(`${storageKey}_tokenMap`, analysis.tokenCountMap)

      const hasRaw = !isText
        ? Boolean(
            (await this.dependencies.blobs.get(rawStorageKey).catch(() => null)) ??
              (await this.storeRawAsset(asset, rawStorageKey))
          )
        : false

      return {
        asset,
        content: existingContent,
        storageKey,
        rawStorageKey: hasRaw ? rawStorageKey : undefined,
        parserType,
        ...analysis,
      }
    }

    if (!isText) {
      await this.storeRawAsset(asset, rawStorageKey)
    }

    const parsed = await this.dependencies.parser.parse(asset, options)
    if (parsed.content) {
      await this.dependencies.blobs.set(storageKey, parsed.content)
    }
    if (parsed.skipAnalysisAndMetadata) {
      return {
        asset,
        content: parsed.content,
        storageKey,
        rawStorageKey: isText ? undefined : rawStorageKey,
        ragMode: 'inline',
        parserType: parsed.parserType,
      }
    }
    const analysis = await this.dependencies.analysis.analyze({
      asset,
      content: parsed.content,
      parserType: parsed.parserType,
      existingTokenCountMap: parsed.tokenCountMap ?? {},
    })
    await this.dependencies.metadata.set(`${storageKey}_tokenMap`, analysis.tokenCountMap)
    await this.dependencies.metadata.set(`${storageKey}_parserType`, parsed.parserType)

    return {
      asset,
      content: parsed.content,
      storageKey,
      rawStorageKey: isText ? undefined : rawStorageKey,
      parserType: parsed.parserType,
      ...analysis,
    }
  }

  private async storeRawAsset(asset: PickedAsset, rawStorageKey: string): Promise<boolean> {
    try {
      const dataUrl = this.dependencies.content.readDataUrl
        ? await this.dependencies.content.readDataUrl(asset)
        : `data:${asset.mimeType || 'application/octet-stream'};base64,${encodeBase64(
            await this.dependencies.content.readBytes(asset)
          )}`
      await this.dependencies.blobs.set(rawStorageKey, dataUrl)
      return true
    } catch (error) {
      await this.dependencies.logger?.log('warn', `Failed to store raw attachment "${asset.name}"`, { error })
      return false
    }
  }
}
