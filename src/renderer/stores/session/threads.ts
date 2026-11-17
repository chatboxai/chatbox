import { type CurrentThreadTarget, ThreadService } from '@chatbox/core/application/session'
import { isActionAvailableInMode, resolveSessionMode } from '@chatbox/core/session/mode-policy'
import * as defaults from '@shared/defaults'
import type { SessionThread } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import { rendererApplication } from '@/app/renderer-application'
import * as dom from '@/hooks/dom'
import { getSessionAgentModeEntry } from './agent-mode'
import { getSessionHeader } from './session-settings'
import { switchCurrentSession } from './crud'

const threadService = new ThreadService({
  sessions: {
    getCurrentThreadIdentity: (id) => rendererApplication.sessions.getCurrentThreadIdentity(id),
    executeStructureCommand: (id, operation, onCommitted) =>
      rendererApplication.sessions.executeStructureCommand(id, operation, onCommitted),
    getSessionHeader: (id) => rendererApplication.sessions.getSessionHeader(id),
    readSessionThread: (request) => rendererApplication.sessions.readSessionThread(request),
  },
  createId: uuidv4,
  now: Date.now,
  getDefaultSystemPrompt: defaults.getDefaultPrompt,
  getLiveMessageIds: (sessionId) =>
    new Set(rendererApplication.generationRuntime.list(sessionId).map((entry) => entry.messageId)),
  subscribeGenerationRuntime: (listener) => rendererApplication.generationRuntime.subscribe(listener),
  cancelMessageIds: (sessionId, messageIds) => {
    for (const id of messageIds) rendererApplication.generationRuntime.requestAbort(sessionId, id, 'thread-changed')
  },
  copyThread: (source) => rendererApplication.sessions.copySessionThread(source),
})

export function editThread(sessionId: string, threadId: string, newThread: Pick<Partial<SessionThread>, 'name'>) {
  return threadService.edit(sessionId, threadId, newThread)
}

export function removeThread(sessionId: string, threadId: string, expectedCurrent?: CurrentThreadTarget) {
  return threadService.remove(sessionId, threadId, expectedCurrent)
}

export async function switchThread(sessionId: string, threadId: string) {
  await threadService.switch(sessionId, threadId)
}

async function createThreadWithRollback(sessionId: string) {
  const session = await getSessionHeader(sessionId)
  if (!session) return false
  // Mode-policy backstop: work mode is a single linear conversation and has
  // no New Thread. Compaction still archives via compressAndCreate.
  if (
    !isActionAvailableInMode('create-thread', resolveSessionMode(getSessionAgentModeEntry(sessionId, session).value))
  ) {
    return false
  }
  return threadService.createWithRollback(sessionId)
}

export async function refreshContextAndCreateNewThread(sessionId: string) {
  return Boolean(await createThreadWithRollback(sessionId))
}

export async function startNewThread(sessionId: string) {
  const target = await createThreadWithRollback(sessionId)
  if (!target) return
  setTimeout(() => {
    dom.focusMessageInput()
  }, 100)
  return () => threadService.rollbackCreated(target)
}

export function removeCurrentThread(sessionId: string) {
  return threadService.removeCurrent(sessionId)
}

export async function compressAndCreateThread(sessionId: string, summary: string) {
  if (await threadService.compressAndCreate(sessionId, summary)) {
    setTimeout(() => {
      dom.focusMessageInput()
    }, 100)
  }
}

export async function moveThreadToConversations(sessionId: string, threadId: string) {
  const newSessionId = await threadService.moveToConversation(sessionId, threadId)
  if (newSessionId) switchCurrentSession(newSessionId)
}

export async function moveCurrentThreadToConversations(sessionId: string) {
  const newSessionId = await threadService.moveCurrentToConversation(sessionId)
  if (newSessionId) switchCurrentSession(newSessionId)
}
