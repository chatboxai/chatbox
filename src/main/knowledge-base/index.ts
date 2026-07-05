import { sentry } from '../../shared/sentry-shim'
import { getLogger } from '../util'
import { initializeDatabase } from './db'
import { startWorkerLoop } from './file-loaders'
import { registerKnowledgeBaseHandlers } from './ipc-handlers'

const log = getLogger('knowledge-base:index')

let initPromise: Promise<void> | null = null

async function initializeKnowledgeBase() {
  const startTime = Date.now()
  log.info('[KB] Initializing knowledge base system...')

  try {
    // Register IPC handlers
    registerKnowledgeBaseHandlers()
    log.debug('[KB] IPC handlers registered')

    // Initialize database and vector store
    await initializeDatabase()
    log.debug('[KB] Database initialized')

    // Start background file processing worker
    void startWorkerLoop()
    log.debug('[KB] Worker loop started')

    const duration = Date.now() - startTime
    log.info(`[KB] Knowledge base system initialized successfully in ${duration}ms`)
  } catch (error) {
    const duration = Date.now() - startTime
    log.error(`[KB] Failed to initialize knowledge base system after ${duration}ms:`, error)

    // Report critical initialization errors to Sentry
    sentry.withScope((scope) => {
      scope.setTag('component', 'knowledge-base')
      scope.setTag('operation', 'initialization')
      scope.setExtra('duration', duration)
      scope.setExtra('error_type', 'initialization_failure')
      sentry.captureException(error)
    })

    throw error
  }
}

export function getInitPromise() {
  if (!initPromise) {
    initPromise = initializeKnowledgeBase()
  }
  return initPromise
}

// Auto-initialize when module is imported with error handling
getInitPromise().catch((error) => {
  log.error('[KB] Knowledge base auto-initialization failed:', error)
  // Don't rethrow here to avoid unhandled promise rejection
})

// Re-export public APIs for external use
export { getDatabase, getVectorStore, parseSQLiteTimestamp, withTransaction } from './db'
export { readChunks, searchKnowledgeBase } from './file-loaders'
export { getEmbeddingProvider, getRerankProvider, getVisionProvider } from './model-providers'
