import { ThreadLinksCache, type ThreadLinks, ThreadLinksBuilder, type ThreadLink } from '@chatbox/core/persistence'
import { MESSAGE_TREE, decodeTreeMetadata, type StoredTreeMetadata } from './session-row-idb-tree'
import { messageMetadata } from './session-row-idb-messages'

const BATCH = 2000
const caches = new WeakMap<IDBDatabase, ThreadLinksCache>()
export function treeLinksCache(db: IDBDatabase): ThreadLinksCache {
  let cache = caches.get(db)
  if (!cache) {
    cache = new ThreadLinksCache()
    caches.set(db, cache)
  }
  return cache
}

function treeBatch(tx: IDBTransaction, sessionId: string, threadId: string, after: IDBValidKey | undefined) {
  return tx
    .objectStore(MESSAGE_TREE)
    .getAll(IDBKeyRange.bound(after ?? [sessionId, threadId], [sessionId, threadId, []], after !== undefined), BATCH)
}

function toLinks(rows: StoredTreeMetadata[]): ThreadLink[] {
  return rows.map((value) => {
    const { facts, ...row } = decodeTreeMetadata(value)
    return { ...messageMetadata(row), facts }
  })
}

/** Builds the graph page by page; `readBatch` decides the transaction each page runs in. */
async function buildTreeLinks(
  sessionId: string,
  threadId: string,
  readBatch: (after: IDBValidKey | undefined) => Promise<StoredTreeMetadata[]>,
  afterBatch?: () => Promise<void>
): Promise<ThreadLinks> {
  const builder = new ThreadLinksBuilder(threadId)
  let after: IDBValidKey | undefined
  for (;;) {
    const rows = await readBatch(after)
    builder.append(toLinks(rows))
    if (rows.length < BATCH) return builder.finish()
    after = [sessionId, threadId, rows.at(-1)!.messageId]
    await afterBatch?.()
  }
}

export function loadTreeLinks(
  tx: IDBTransaction,
  sessionId: string,
  threadId: string,
  revision: number
): Promise<ThreadLinks> {
  const cache = treeLinksCache(tx.db)
  cache.observe(sessionId, revision)
  const known = cache.peek(sessionId, threadId, revision)
  if (known) return Promise.resolve(known)
  // Transaction-local requests keep this transaction active while each batch yields to IndexedDB.
  return buildTreeLinks(
    sessionId,
    threadId,
    (after) =>
      new Promise((resolve, reject) => {
        const request = treeBatch(tx, sessionId, threadId, after)
        request.onsuccess = () => resolve(request.result as StoredTreeMetadata[])
        request.onerror = () => reject(request.error)
      })
  ).then((graph) => {
    cache.loaded(sessionId, threadId, revision, graph)
    return graph
  })
}

/** Separate readonly transactions allow yielding between primary-key batches without auto-commit hazards. */
export async function prefetchTreeLinks(
  db: IDBDatabase,
  sessionId: string,
  threadId: string,
  root: string | null,
  revision: number,
  signal?: AbortSignal
): Promise<void> {
  const cache = treeLinksCache(db)
  cache.observe(sessionId, revision)
  if (cache.peek(sessionId, threadId, revision)) return
  const yieldTask = async () => {
    signal?.throwIfAborted()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    signal?.throwIfAborted()
  }
  // Each batch reads the revision head in its own transaction, so a concurrent commit discards the prefetch.
  const fenced = <T>(stores: string[], read: (tx: IDBTransaction) => IDBRequest<T> | undefined) =>
    new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(stores, 'readonly')
      const head = tx.objectStore('threads').get([sessionId, '__chatbox_internal_revision_head__'])
      const request = read(tx)
      tx.oncomplete = () =>
        head.result?.commitRevision === revision
          ? resolve(request?.result)
          : reject(new Error('Thread links revision changed during prefetch'))
      tx.onabort = tx.onerror = () => reject(tx.error)
    })
  await cache.get(sessionId, threadId, revision, async () => {
    signal?.throwIfAborted()
    const graph = await buildTreeLinks(
      sessionId,
      threadId,
      async (after) =>
        (await fenced(['threads', MESSAGE_TREE], (tx) =>
          treeBatch(tx, sessionId, threadId, after)
        )) as StoredTreeMetadata[],
      yieldTask
    )
    await graph.preparePath(root, yieldTask)
    // Recheck after the final yielded derivation as well as every data batch.
    await fenced(['threads'], () => undefined)
    signal?.throwIfAborted()
    return graph
  })
}
