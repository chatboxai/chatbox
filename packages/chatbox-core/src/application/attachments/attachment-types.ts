import type { SessionAttachmentAvailability } from '../../types'

/**
 * Host-neutral representation of a file selected by the user.
 *
 * Browser File, React Native picker responses and native file handles remain
 * private to their host adapter. Application services only keep stable
 * metadata and ask a content port for bytes when needed.
 */
export interface PickedAsset {
  id: string
  uri: string
  name: string
  mimeType: string
  size: number
  lastModified?: number
}

export interface PickedAssetContentPort {
  readBytes(asset: PickedAsset): Promise<Uint8Array>
  /**
   * Hosts with an efficient native/base64 implementation may provide the
   * historical data URL directly. Hermes-only hosts can omit it.
   */
  readDataUrl?(asset: PickedAsset): Promise<string>
}

export interface ParsedAttachmentContent {
  content: string
  parserType: string
  tokenCountMap?: Record<string, number>
  /**
   * Preserve the legacy raw-only sandbox path, which intentionally stores no
   * token/preview metadata because the descriptor is not parsed file content.
   */
  skipAnalysisAndMetadata?: boolean
}

export interface AttachmentParserPort {
  parse(asset: PickedAsset, options: AttachmentPreparationOptions): Promise<ParsedAttachmentContent>
}

export interface AttachmentAnalysis {
  ragMode: 'inline' | 'session-retrieval'
  tokenCountMap: Record<string, number>
  lineCount: number
  byteLength: number
  sessionAttachmentAvailability?: SessionAttachmentAvailability
  sessionAttachmentBlockedReason?: string
  sessionAttachmentWarningReason?: string
}

export interface AttachmentAnalysisPort {
  analyze(input: {
    asset: PickedAsset
    content: string
    parserType?: string
    existingTokenCountMap: Record<string, number>
  }): Promise<AttachmentAnalysis>
}

export interface AttachmentPreparationOptions {
  agentMode?: boolean
  source?: 'pasted-text'
}

export interface PreparedAttachment {
  asset: PickedAsset
  content: string
  storageKey: string
  rawStorageKey?: string
  localPath?: string
  ragMode?: 'inline' | 'session-retrieval'
  parserType?: string
  sessionAttachmentAvailability?: SessionAttachmentAvailability
  sessionAttachmentBlockedReason?: string
  sessionAttachmentWarningReason?: string
  tokenCountMap?: Record<string, number>
  lineCount?: number
  byteLength?: number
  error?: string
}
