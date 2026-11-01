import { SESSION_ATTACHMENT_RAG_LOG_PREFIX } from '../../shared/session-attachment-rag/logging'
import { getLogger } from '../util'
import { initializeDatabase } from './db'
import { startWorkerLoop } from './file-loaders'
import { registerSessionAttachmentRagHandlers } from './ipc-handlers'

const log = getLogger('session-attachment-rag:index')

let initPromise: Promise<void> | null = null

async function initializeSessionAttachmentRag() {
  const startTime = Date.now()
  log.info(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} Initializing session attachment rag system...`)

  try {
    registerSessionAttachmentRagHandlers()
    await initializeDatabase()
    void startWorkerLoop()
    const duration = Date.now() - startTime
    log.info(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} Initialized successfully in ${duration}ms`)
  } catch (error) {
    const duration = Date.now() - startTime
    log.error(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} Failed to initialize after ${duration}ms:`, error)
    throw error
  }
}

export function getInitPromise() {
  if (!initPromise) {
    initPromise = initializeSessionAttachmentRag()
  }
  return initPromise
}

getInitPromise().catch((error) => {
  log.error(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} Auto-initialization failed:`, error)
})

export {
  cleanupReadyAttachmentsMissingVectorIndexes,
  createSessionAttachment,
  deleteAttachmentGraph,
  deleteAttachmentIndex,
  deleteMessageAttachments,
  deleteSessionAttachments,
  getDatabase,
  getSessionAttachment,
  getSessionAttachmentRagDbPath,
  getSessionAttachmentRagVectorDbPath,
  getVectorStore,
  listPendingSessionAttachments,
  listSessionAttachmentsByIds,
  markSessionAttachmentFailed,
  markSessionAttachmentIndexing,
  markSessionAttachmentReady,
  parseSQLiteTimestamp,
  readSessionAttachmentParents,
  replaceAttachmentParentsAndChunks,
  retrySessionAttachment,
  withTransaction,
} from './db'
