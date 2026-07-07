import { ipcMain } from 'electron'
import { getLogger } from '../util'
import {
  type ChatSearchEntry,
  clearIndex,
  deleteSessionIndex,
  getMeta,
  queryIndex,
  setMeta,
  upsertSessionIndex,
} from './db'

const log = getLogger('chat-search:ipc')

const MAX_QUERY_LIMIT = 500

// Throw-style handlers: the renderer treats any failure as "index unavailable"
// and falls back to the brute-force scan, so errors just propagate.
export function registerChatSearchHandlers(): void {
  ipcMain.handle(
    'chat-search:upsert-session',
    async (_event, payload: { sessionId: string; entries: ChatSearchEntry[] }) => {
      if (!payload || typeof payload.sessionId !== 'string' || !Array.isArray(payload.entries)) {
        throw new Error('chat-search:upsert-session: invalid payload')
      }
      const entries = payload.entries.filter(
        (e): e is ChatSearchEntry => !!e && typeof e.messageId === 'string' && typeof e.text === 'string'
      )
      await upsertSessionIndex(payload.sessionId, entries)
    }
  )

  ipcMain.handle('chat-search:delete-sessions', async (_event, payload: { sessionIds: string[] }) => {
    if (!payload || !Array.isArray(payload.sessionIds)) {
      throw new Error('chat-search:delete-sessions: invalid payload')
    }
    await deleteSessionIndex(payload.sessionIds.filter((id): id is string => typeof id === 'string'))
  })

  ipcMain.handle('chat-search:query', async (_event, payload: { query: string; limit?: number }) => {
    if (!payload || typeof payload.query !== 'string') {
      throw new Error('chat-search:query: invalid payload')
    }
    const limit = Math.min(Math.max(1, Math.trunc(payload.limit ?? 200)), MAX_QUERY_LIMIT)
    return await queryIndex(payload.query, limit)
  })

  ipcMain.handle('chat-search:get-meta', async (_event, payload: { key: string }) => {
    if (!payload || typeof payload.key !== 'string') {
      throw new Error('chat-search:get-meta: invalid payload')
    }
    return await getMeta(payload.key)
  })

  ipcMain.handle('chat-search:set-meta', async (_event, payload: { key: string; value: string }) => {
    if (!payload || typeof payload.key !== 'string' || typeof payload.value !== 'string') {
      throw new Error('chat-search:set-meta: invalid payload')
    }
    await setMeta(payload.key, payload.value)
  })

  ipcMain.handle('chat-search:clear', async () => {
    await clearIndex()
  })

  log.info('chat-search IPC handlers registered')
}
