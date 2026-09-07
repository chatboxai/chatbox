import type { SessionHeader } from '@chatbox/core/ports'
import type { StateSnapshot } from 'react-virtuoso'
import type { MessageRenderItem } from './message-render-items'

export interface WindowTranscriptIdentity {
  threadId: string
  revision: number
}

export interface WindowScrollKey extends WindowTranscriptIdentity {
  sessionId: string
  signature: string | null
  itemCount: number
}

export interface WindowScrollAnchor {
  messageId: string
  offset: number
}

export interface WindowScrollEntry {
  /** Geometry schema; the message anchor is validated against the current transcript. */
  version: number
  key: WindowScrollKey
  layout: string
  snapshot: StateSnapshot | null
  anchor: WindowScrollAnchor
  following: boolean
}

const MAX_ITEMS = 200
const MAX_ENTRIES = 100
const MAX_SIGNATURE_LENGTH = 16000
const entries = new Map<string, WindowScrollEntry>()
const invalidationListeners = new Map<string, Set<() => void>>()
// Commit identity remains authoritative. Weak object tokens additionally reject renderer-only
// replacements while avoiding retention of message payloads in the geometry cache.
const objectIds = new WeakMap<object, number>()
let nextObjectId = 1

export function windowScrollObjectId(value: object): number {
  let id = objectIds.get(value)
  if (id === undefined) {
    id = nextObjectId++
    objectIds.set(value, id)
  }
  return id
}

export function createWindowScrollKey(
  header: SessionHeader,
  identity: WindowTranscriptIdentity | undefined,
  items: MessageRenderItem[],
  firstItemIndex: number
): WindowScrollKey | null {
  if (!identity?.threadId || !Number.isSafeInteger(identity.revision) || identity.revision < 0 || items.length === 0)
    return null
  const signature =
    items.length > MAX_ITEMS
      ? null
      : JSON.stringify([
          1,
          firstItemIndex,
          windowScrollObjectId(header),
          items.map((item) => [
            item.type,
            item.key,
            ...item.messages.map((message) => [message.id, windowScrollObjectId(message)]),
          ]),
        ])
  return {
    sessionId: header.id,
    ...identity,
    signature: signature && signature.length <= MAX_SIGNATURE_LENGTH ? signature : null,
    itemCount: items.length,
  }
}

export function getWindowScrollPosition(sessionId: string): WindowScrollEntry | undefined {
  return entries.get(sessionId)
}

export function clearWindowScrollPosition(sessionId: string): void {
  entries.delete(sessionId)
  for (const listener of invalidationListeners.get(sessionId) ?? []) listener()
}

export function discardWindowScrollPosition(sessionId: string): void {
  entries.delete(sessionId)
}

export function observeWindowScrollInvalidation(sessionId: string, listener: () => void): () => void {
  const listeners = invalidationListeners.get(sessionId) ?? new Set<() => void>()
  listeners.add(listener)
  invalidationListeners.set(sessionId, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) invalidationListeners.delete(sessionId)
  }
}

export function boundedWindowSnapshot(snapshot: StateSnapshot, itemCount: number): StateSnapshot | null {
  if (!Number.isSafeInteger(itemCount) || itemCount < 1 || itemCount > MAX_ITEMS) return null
  if (
    !Number.isFinite(snapshot.scrollTop) ||
    snapshot.scrollTop < 0 ||
    snapshot.ranges.length === 0 ||
    snapshot.ranges.length > MAX_ITEMS
  )
    return null
  const ranges: StateSnapshot['ranges'] = []
  let nextIndex = 0
  for (const range of snapshot.ranges) {
    const endIndex = Math.min(range.endIndex, itemCount - 1)
    if (
      !Number.isSafeInteger(range.startIndex) ||
      range.startIndex !== nextIndex ||
      !Number.isSafeInteger(endIndex) ||
      endIndex < range.startIndex ||
      !Number.isFinite(range.size) ||
      range.size <= 0
    )
      return null
    ranges.push({ ...range, endIndex })
    nextIndex = endIndex + 1
    if (nextIndex === itemCount) break
  }
  return nextIndex === itemCount ? { scrollTop: snapshot.scrollTop, ranges } : null
}

export function saveWindowScrollPosition(entry: WindowScrollEntry): void {
  if (entry.version !== 1 || !Number.isFinite(entry.anchor.offset)) return
  entries.delete(entry.key.sessionId)
  entries.set(entry.key.sessionId, entry)
  if (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value
    if (oldest !== undefined) entries.delete(oldest)
  }
}

export function resolveWindowScrollPosition(
  entry: WindowScrollEntry | undefined,
  key: WindowScrollKey | null,
  layout: string,
  items: MessageRenderItem[]
): { snapshot: StateSnapshot; following: boolean } | { anchorIndex: number } | null {
  if (!entry || !key || entry.key.sessionId !== key.sessionId || entry.key.threadId !== key.threadId) return null
  if (
    entry.version === 1 &&
    key.signature !== null &&
    entry.key.revision === key.revision &&
    entry.key.signature === key.signature &&
    entry.layout === layout &&
    entry.snapshot
  ) {
    const snapshot = boundedWindowSnapshot(entry.snapshot, items.length)
    if (snapshot) return { snapshot, following: entry.following }
  }
  if (entry.following) return null
  const anchorIndex = items.findIndex((item) => item.messages.some((message) => message.id === entry.anchor.messageId))
  return anchorIndex < 0 ? null : { anchorIndex }
}
