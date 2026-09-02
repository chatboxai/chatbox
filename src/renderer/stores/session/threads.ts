import { ThreadService } from '@chatbox/core/application/session'
import { isActionAvailableInMode, resolveSessionMode } from '@chatbox/core/session/mode-policy'
import * as defaults from '@shared/defaults'
import type { SessionThread } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import { rendererApplication } from '@/app/renderer-application'
import * as dom from '@/hooks/dom'
import * as scrollActions from '../scrollActions'
import { getSessionAgentModeEntry } from './agent-mode'
import { _copySession as copySession, switchCurrentSession } from './crud'

const threadService = new ThreadService({
  sessions: {
    getSession: (sessionId) => rendererApplication.sessionQueryBridge.getSession(sessionId),
    updateSession: (sessionId, updater) => rendererApplication.sessions.updateSession(sessionId, updater),
    updateSessionWithMessages: (sessionId, updater) =>
      rendererApplication.sessions.updateSessionWithMessages(sessionId, updater),
  },
  createId: uuidv4,
  now: Date.now,
  getDefaultSystemPrompt: defaults.getDefaultPrompt,
  cancelMessages: (sessionId, messages) => {
    for (const message of messages) {
      if (message.generating || rendererApplication.generationRuntime.get(sessionId, message.id)) {
        rendererApplication.generationRuntime.requestAbort(sessionId, message.id, 'thread-changed')
      }
    }
  },
  copySession: (source) => copySession(source),
})

export function editThread(sessionId: string, threadId: string, newThread: Pick<Partial<SessionThread>, 'name'>) {
  return threadService.edit(sessionId, threadId, newThread)
}

export function removeThread(sessionId: string, threadId: string) {
  return threadService.remove(sessionId, threadId)
}

export async function switchThread(sessionId: string, threadId: string) {
  if (await threadService.switch(sessionId, threadId)) {
    setTimeout(() => scrollActions.scrollToBottom('smooth'), 300)
  }
}

export async function refreshContextAndCreateNewThread(sessionId: string) {
  const session = await rendererApplication.sessionQueryBridge.getSession(sessionId)
  if (!session) return false
  // Mode-policy backstop: work mode is a single linear conversation and has
  // no New Thread. Compaction still archives via compressAndCreate.
  if (
    !isActionAvailableInMode('create-thread', resolveSessionMode(getSessionAgentModeEntry(sessionId, session).value))
  ) {
    return false
  }
  return threadService.refreshContextAndCreateNew(sessionId)
}

export async function startNewThread(sessionId: string) {
  if (!(await refreshContextAndCreateNewThread(sessionId))) return
  setTimeout(() => {
    scrollActions.scrollToBottom()
    dom.focusMessageInput()
  }, 100)
}

export function removeCurrentThread(sessionId: string) {
  return threadService.removeCurrent(sessionId)
}

export async function compressAndCreateThread(sessionId: string, summary: string) {
  if (await threadService.compressAndCreate(sessionId, summary)) {
    setTimeout(() => {
      scrollActions.scrollToBottom()
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
