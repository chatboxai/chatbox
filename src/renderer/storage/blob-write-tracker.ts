/**
 * In-memory log of blob writes in this app session.
 *
 * A blob may be written before its durable reference is persisted (image
 * generation records, streaming message pictures, temporary parse caches, …).
 * The orphaned-blob cleanup consults this log so a quota-triggered run never
 * deletes a blob inside that window. Tracking happens at the platform boundary
 * (see platform/index.ts) so every producer path is covered, including code
 * that calls `platform.setStoreBlob()` directly instead of `storage.setBlob()`.
 *
 * Content-addressed blob reuse (generation request definitions) calls
 * `trackBlobWrite()` without rewriting the blob, so a reused key re-enters the
 * in-flight window until its new session reference is persisted.
 */

const recentBlobWrites = new Map<string, number>()

export function trackBlobWrite(key: string): void {
  recentBlobWrites.set(key, Date.now())
}

/**
 * Keys of blobs written within the last `withinMs` milliseconds.
 * Expired entries are pruned on each call.
 */
export function getRecentlyWrittenBlobKeys(withinMs: number): string[] {
  const now = Date.now()
  const keys: string[] = []
  for (const [key, writtenAt] of recentBlobWrites) {
    if (now - writtenAt > withinMs) {
      recentBlobWrites.delete(key)
    } else {
      keys.push(key)
    }
  }
  return keys
}

/** Recheck one key immediately before a destructive cleanup action. */
export function isBlobRecentlyWritten(key: string, withinMs: number): boolean {
  const writtenAt = recentBlobWrites.get(key)
  if (writtenAt === undefined) return false
  if (Date.now() - writtenAt > withinMs) {
    recentBlobWrites.delete(key)
    return false
  }
  return true
}
