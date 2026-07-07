import { getLogger } from '../util'
import { initializeDatabase } from './db'
import { registerChatSearchHandlers } from './ipc-handlers'

const log = getLogger('chat-search:index')

let initPromise: Promise<void> | null = null

async function initializeChatSearch() {
  const startTime = Date.now()
  try {
    registerChatSearchHandlers()
    await initializeDatabase()
    log.info(`chat-search initialized in ${Date.now() - startTime}ms`)
  } catch (error) {
    log.error(`chat-search failed to initialize after ${Date.now() - startTime}ms:`, error)
    throw error
  }
}

export function getInitPromise() {
  if (!initPromise) {
    initPromise = initializeChatSearch()
  }
  return initPromise
}

getInitPromise().catch((error) => {
  log.error('chat-search auto-initialization failed:', error)
})
