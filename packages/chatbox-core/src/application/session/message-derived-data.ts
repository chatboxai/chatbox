import type { Message, MessageFile, MessageLink, TokenCacheKey } from '../../types/session'
import { getMessageText } from '../../utils/message'

type TextTokenizerType = Extract<TokenCacheKey, 'default' | 'deepseek'>
type TokenValues = Partial<Record<TokenCacheKey, number>>

export interface SessionMessageTextDerivedPatch {
  tokenizerType: TextTokenizerType
  sourceDigest: string
  tokens: number
  calculatedAt: number
  approximate?: boolean
}

export interface SessionAttachmentDerivedPatch {
  id: string
  type: 'file' | 'link'
  sourceStorageKey: string
  sourceName: string
  tokenCountMap?: TokenValues
  tokenCalculatedAt?: TokenValues
  /** Calculation that produced the shared dimensions; must also appear in tokenCalculatedAt. */
  metadataCalculatedAt?: number
  lineCount?: number
  byteLength?: number
}

/** Derived caches can change without changing message content or tree structure. */
export interface SessionMessageDerivedPatch {
  messageId: string
  attachments?: SessionAttachmentDerivedPatch[]
}

const TOKEN_KEYS: readonly TokenCacheKey[] = ['default', 'deepseek', 'default_preview', 'deepseek_preview']

export function getSessionMessageTokenizationText(message: Message): string {
  return getMessageText(message, true, true)
}

/** Source identity shared by asynchronous token computation and cache application. */
export function getTokenizationTextDigest(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`
}

export function getSessionMessageTokenizationDigest(message: Message): string {
  return getTokenizationTextDigest(getSessionMessageTokenizationText(message))
}

function applyAttachmentPatch<T extends MessageFile | MessageLink>(
  attachment: T,
  patch: SessionAttachmentDerivedPatch
): { attachment: T; patch: SessionAttachmentDerivedPatch } | null {
  const name = 'name' in attachment ? attachment.name : attachment.title
  if (
    attachment.id !== patch.id ||
    !patch.sourceStorageKey ||
    attachment.storageKey !== patch.sourceStorageKey ||
    name !== patch.sourceName
  ) {
    return null
  }

  const tokenCountMap: TokenValues = {}
  const tokenCalculatedAt: TokenValues = {}
  let hasTokenChanges = false
  for (const key of TOKEN_KEYS) {
    const tokens = patch.tokenCountMap?.[key]
    const calculatedAt = patch.tokenCalculatedAt?.[key]
    if (calculatedAt !== undefined && calculatedAt < (attachment.tokenCalculatedAt?.[key] ?? 0)) continue
    if (tokens !== undefined) {
      tokenCountMap[key] = tokens
      hasTokenChanges ||= tokens !== attachment.tokenCountMap?.[key]
    }
    if (calculatedAt !== undefined) {
      tokenCalculatedAt[key] = calculatedAt
      hasTokenChanges ||= calculatedAt !== attachment.tokenCalculatedAt?.[key]
    }
  }
  const hasTokenCounts = Object.keys(tokenCountMap).length > 0
  const hasCalculatedAt = Object.keys(tokenCalculatedAt).length > 0
  const latestCalculation = Math.max(
    0,
    ...TOKEN_KEYS.map((key) => attachment.tokenCalculatedAt?.[key] ?? 0),
    ...Object.values(tokenCalculatedAt)
  )
  const acceptsMetadata =
    patch.metadataCalculatedAt !== undefined &&
    patch.metadataCalculatedAt >= latestCalculation &&
    Object.values(tokenCalculatedAt).includes(patch.metadataCalculatedAt)
  const hasLineCount = acceptsMetadata && patch.lineCount !== undefined && patch.lineCount !== attachment.lineCount
  const hasByteLength = acceptsMetadata && patch.byteLength !== undefined && patch.byteLength !== attachment.byteLength
  if (!hasTokenChanges && !hasLineCount && !hasByteLength) return null

  return {
    attachment: {
      ...attachment,
      ...(hasTokenCounts ? { tokenCountMap: { ...attachment.tokenCountMap, ...tokenCountMap } } : {}),
      ...(hasCalculatedAt ? { tokenCalculatedAt: { ...attachment.tokenCalculatedAt, ...tokenCalculatedAt } } : {}),
      ...(hasLineCount ? { lineCount: patch.lineCount } : {}),
      ...(hasByteLength ? { byteLength: patch.byteLength } : {}),
    },
    patch: {
      id: patch.id,
      type: patch.type,
      sourceStorageKey: patch.sourceStorageKey,
      sourceName: patch.sourceName,
      ...(hasTokenCounts ? { tokenCountMap } : {}),
      ...(hasCalculatedAt ? { tokenCalculatedAt } : {}),
      ...(acceptsMetadata && (patch.lineCount !== undefined || patch.byteLength !== undefined)
        ? { metadataCalculatedAt: patch.metadataCalculatedAt }
        : {}),
      ...(acceptsMetadata && patch.lineCount !== undefined ? { lineCount: patch.lineCount } : {}),
      ...(acceptsMetadata && patch.byteLength !== undefined ? { byteLength: patch.byteLength } : {}),
    },
  }
}

/**
 * Applies only source-matching derived fields. The accepted patch can be replayed
 * against another cached copy without replacing its message content.
 */
export function applySessionMessageDerivedPatch(
  message: Message,
  patch: SessionMessageDerivedPatch
): { message: Message; patch: SessionMessageDerivedPatch } | null {
  if (message.id !== patch.messageId) return null

  let updated = message
  const acceptedAttachments: SessionAttachmentDerivedPatch[] = []
  for (const entry of patch.attachments ?? []) {
    if (entry.type === 'file') {
      const index = updated.files?.findIndex((file) => file.id === entry.id) ?? -1
      if (!updated.files || index < 0) continue
      const result = applyAttachmentPatch(updated.files[index], entry)
      if (!result) continue
      const files = [...updated.files]
      files[index] = result.attachment
      updated = { ...updated, files }
      acceptedAttachments.push(result.patch)
    } else if (entry.type === 'link') {
      const index = updated.links?.findIndex((link) => link.id === entry.id) ?? -1
      if (!updated.links || index < 0) continue
      const result = applyAttachmentPatch(updated.links[index], entry)
      if (!result) continue
      const links = [...updated.links]
      links[index] = result.attachment
      updated = { ...updated, links }
      acceptedAttachments.push(result.patch)
    }
  }

  if (updated === message) return null
  return {
    message: updated,
    patch: {
      messageId: message.id,
      ...(acceptedAttachments.length ? { attachments: acceptedAttachments } : {}),
    },
  }
}
