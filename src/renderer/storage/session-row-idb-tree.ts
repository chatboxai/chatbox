import type { MessageRowMetadata, SessionMessageFacts } from '@chatbox/core/session/session-tree'

export const MESSAGE_TREE = 'messageTree'
export const TREE_MESSAGE_ID = 'byMessage'
const FLAGS = [
  'autoTitleEligible',
  'contextEligible',
  'hasToolCall',
  'isForkMarker',
  'hasFiles',
  'paused',
  'webSearchSignInError',
  'hasLegacyCommand',
  'steered',
  'hasError',
] as const
const ARRAYS = ['seedAttachments', 'imageStorageKeys', 'attachmentOwnershipIds', 'fileResourceKeys'] as const
export type TreeMetadata = Omit<MessageRowMetadata, 'selected'> & {
  facts: SessionMessageFacts
  tokenPayloadId?: string
  payloadBytes: number
}
export type StoredTreeMetadata = Omit<TreeMetadata, 'facts'> &
  Pick<SessionMessageFacts, 'role' | 'promptCacheChars'> &
  Partial<Pick<SessionMessageFacts, 'finishReason' | 'timestamp' | (typeof ARRAYS)[number]>> & {
    flags: number
    presence: number
  }

/** The codec changes representation only; every fact remains available without loading a body. */
export function encodeTreeMetadata(row: TreeMetadata): StoredTreeMetadata {
  const { facts, selected: _selected, ...metadata } = row as TreeMetadata & { selected?: boolean }
  const packed: StoredTreeMetadata = {
    ...metadata,
    role: facts.role,
    promptCacheChars: facts.promptCacheChars,
    flags: FLAGS.reduce((mask, name, bit) => mask | (Number(Boolean(facts[name])) << bit), 0),
    presence: Number(facts.isForkMarker !== undefined) | (Number(facts.hasError !== undefined) << 1),
  }
  if (facts.finishReason !== undefined) packed.finishReason = facts.finishReason
  if (facts.timestamp !== undefined) packed.timestamp = facts.timestamp
  for (const [bit, name] of ARRAYS.entries()) {
    if (facts[name] !== undefined) packed.presence |= 1 << (bit + 2)
    if (facts[name]?.length) Object.assign(packed, { [name]: facts[name] })
  }
  return packed
}

export function decodeTreeMetadata(row: StoredTreeMetadata): TreeMetadata {
  const {
    role,
    promptCacheChars,
    finishReason,
    timestamp,
    flags,
    presence,
    seedAttachments,
    imageStorageKeys,
    attachmentOwnershipIds,
    fileResourceKeys,
    ...metadata
  } = row
  if (
    !Number.isSafeInteger(flags) ||
    flags < 0 ||
    flags > 1023 ||
    !Number.isSafeInteger(presence) ||
    presence < 0 ||
    presence > 63
  )
    throw new Error('Invalid message fact encoding')
  const facts: SessionMessageFacts = {
    role,
    promptCacheChars,
    finishReason,
    timestamp,
    seedAttachments: presence & 4 ? (seedAttachments ?? []) : undefined,
    autoTitleEligible: Boolean(flags & 1),
    contextEligible: Boolean(flags & 2),
    hasToolCall: Boolean(flags & 4),
    hasFiles: Boolean(flags & 16),
    paused: Boolean(flags & 32),
    webSearchSignInError: Boolean(flags & 64),
    hasLegacyCommand: Boolean(flags & 128),
    steered: Boolean(flags & 256),
    imageStorageKeys: imageStorageKeys ?? [],
    attachmentOwnershipIds: attachmentOwnershipIds ?? [],
    ...(presence & 1 ? { isForkMarker: Boolean(flags & 8) } : {}),
    ...(presence & 2 ? { hasError: Boolean(flags & 512) } : {}),
    ...(finishReason !== undefined ? { finishReason } : {}),
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...(presence & 4 ? { seedAttachments: seedAttachments ?? [] } : {}),
    ...(presence & 32 ? { fileResourceKeys: fileResourceKeys ?? [] } : {}),
  }
  return { ...metadata, facts }
}

export function treeMessageRequest(
  tx: IDBTransaction,
  sessionId: string,
  messageId: string
): IDBRequest<StoredTreeMetadata | undefined> {
  return tx.objectStore(MESSAGE_TREE).index(TREE_MESSAGE_ID).get([sessionId, messageId])
}
export function readTreeMessage(
  tx: IDBTransaction,
  sessionId: string,
  messageId: string
): Promise<TreeMetadata | null> {
  return new Promise((resolve, reject) => {
    const request = treeMessageRequest(tx, sessionId, messageId)
    request.onsuccess = () => resolve(request.result ? decodeTreeMetadata(request.result) : null)
    request.onerror = () => reject(request.error)
  })
}
