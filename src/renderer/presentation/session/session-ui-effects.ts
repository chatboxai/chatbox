import type { SessionApplicationEvent, SessionEventBus } from '@chatbox/core/application/session'
import { rendererApplication } from '@/app/renderer-application'
import { clearScrollPositionCache } from '@/components/chat/MessageList'
import platform from '@/platform'
import { cleanupSessionAtomCache } from '@/stores/atoms/throttleWriteSessionAtom'
import { clearSessionNameGenerationState, syncSessionAutoTitle } from '@/stores/session/naming'
import { clearSessionActivity } from '@/stores/sessionActivityStore'
import { uiStore } from '@/stores/uiStore'

async function runInChunks<T>(items: T[], chunkSize: number, worker: (item: T) => Promise<void>): Promise<void> {
  for (let index = 0; index < items.length; index += chunkSize) {
    await Promise.all(items.slice(index, index + chunkSize).map((item) => worker(item)))
  }
}

async function cleanupAttachmentRagEntries(event: Extract<SessionApplicationEvent, { type: 'session-will-delete' }>) {
  if (!platform.isDesktopLike) return
  await runInChunks(event.ids, 10, async (sessionId) => {
    try {
      await platform.getSessionAttachmentRagController().deleteSessionAttachments(sessionId)
    } catch (error) {
      console.warn(`Failed to cleanup session attachment RAG entries for ${event.operation}:`, error)
    }
  })
}

function cleanupDeletedSessionRuntimeState(sessionId: string): void {
  uiStore.getState().clearSessionWebBrowsing(sessionId)
  uiStore.getState().removeSessionKnowledgeBase(sessionId)
  uiStore.getState().clearSessionAgentMode(sessionId)
  cleanupSessionAtomCache(sessionId)
  clearScrollPositionCache(sessionId)
  clearSessionNameGenerationState(sessionId)
  clearSessionActivity(sessionId)
  platform.sandboxReset?.({ sessionId }).catch(() => {})
  platform.sandboxRemoveArtifacts?.({ sessionId }).catch(() => {})
}

/**
 * Connects application events to Renderer-only cleanup. This is registered by
 * the Renderer composition root and is not part of the portable SessionService.
 */
export function registerSessionUiEffects(events: SessionEventBus): () => void {
  return events.subscribe(async (event) => {
    if (event.type === 'session-will-delete') {
      for (const sessionId of event.ids) {
        rendererApplication.generationRuntime.abort(sessionId, undefined, 'session-deleted')
      }
      await cleanupAttachmentRagEntries(event)
      return
    }
    if (event.type === 'session-updated' && event.session) {
      // Naming reacts to persisted user/message writes only. Read-repair
      // publishes (meta: null) must not re-enter naming — bulk readers like
      // the startup RAG maintenance sweep and recoverSessionList touch every
      // session — and hidden/archived sessions (bulk archive fan-out) must
      // not trigger backfill writes or naming model calls either.
      if (event.meta && !event.session.hidden) {
        syncSessionAutoTitle(event.session)
      }
      return
    }
    if (event.type === 'session-deleted') {
      for (const sessionId of event.ids) {
        cleanupDeletedSessionRuntimeState(sessionId)
      }
    }
  })
}
