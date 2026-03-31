import * as defaults from '@shared/defaults'
import { createMessage, type Message, type Session, type SessionThread } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { v4 as uuidv4 } from 'uuid'
import * as dom from '@/hooks/dom'
import * as chatStore from '../chatStore'
import * as scrollActions from '../scrollActions'
import { _copySession as copySession, switchCurrentSession } from './crud'

/**
 * Edit a thread (currently only supports name modification)
 * @param sessionId Session id
 * @param threadId Thread id
 * @param newThread Pick<Partial<SessionThread>, 'name'>
 */
export async function editThread(sessionId: string, threadId: string, newThread: Pick<Partial<SessionThread>, 'name'>) {
  const session = await chatStore.getSession(sessionId)
  if (!session || !session.threads) return

  // Special case: if editing the current thread, modify threadName directly
  if (threadId === sessionId) {
    await chatStore.updateSession(sessionId, { threadName: newThread.name })
    return
  }

  const targetThread = session.threads.find((t) => t.id === threadId)
  if (!targetThread) return

  const threads = session.threads.map((t) => {
    if (t.id !== threadId) return t
    return { ...t, ...newThread }
  })

  await chatStore.updateSession(sessionId, { threads })
}

/**
 * Remove a thread
 * @param sessionId Session id
 * @param threadId Thread id
 */
export async function removeThread(sessionId: string, threadId: string) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  if (sessionId === threadId) {
    await removeCurrentThread(sessionId)
    return
  }
  return await chatStore.updateSession(sessionId, {
    threads: session.threads?.filter((t) => t.id !== threadId),
  })
}

/**
 * Switch to a thread from history, current context is stored in history
 * @param sessionId
 * @param threadId
 */
export async function switchThread(sessionId: string, threadId: string) {
  const session = await chatStore.getSession(sessionId)
  if (!session || !session.threads) {
    return
  }
  const target = session.threads.find((h) => h.id === threadId)
  if (!target) {
    return
  }
  for (const m of session.messages) {
    m?.cancel?.()
  }
  const newThreads = session.threads.filter((h) => h.id !== threadId)
  newThreads.push({
    id: uuidv4(),
    name: session.threadName || session.name,
    messages: session.messages,
    createdAt: Date.now(),
    compactionPoints: session.compactionPoints,
  })
  await chatStore.updateSessionWithMessages(session.id, {
    ...session,
    threads: newThreads,
    messages: target.messages,
    threadName: target.name,
    compactionPoints: target.compactionPoints,
  })
  setTimeout(() => scrollActions.scrollToBottom('smooth'), 300)
}

/**
 * Move current messages to history and clear context
 * @param sessionId
 */
export async function refreshContextAndCreateNewThread(sessionId: string) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  for (const m of session.messages) {
    m?.cancel?.()
  }
  const newThread: SessionThread = {
    id: uuidv4(),
    name: session.threadName || session.name,
    messages: session.messages,
    createdAt: Date.now(),
    compactionPoints: session.compactionPoints,
  }

  let systemPrompt = session.messages.find((m) => m.role === 'system')
  if (systemPrompt) {
    systemPrompt = createMessage('system', getMessageText(systemPrompt))
  }
  await chatStore.updateSessionWithMessages(session.id, {
    ...session,
    threads: session.threads ? [...session.threads, newThread] : [newThread],
    messages: systemPrompt ? [systemPrompt] : [createMessage('system', defaults.getDefaultPrompt())],
    threadName: '',
    compactionPoints: undefined,
  })
}

export async function startNewThread(sessionId: string) {
  await refreshContextAndCreateNewThread(sessionId)
  // Auto-scroll to bottom and focus input
  setTimeout(() => {
    scrollActions.scrollToBottom()
    dom.focusMessageInput()
  }, 100)
}

/**
 * Remove current thread. If history threads exist, switch to last one; otherwise clear session
 */
export async function removeCurrentThread(sessionId: string) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  const updatedSession: Session = {
    ...session,
    messages: session.messages.filter((m) => m.role === 'system').slice(0, 1), // Keep only one system prompt
    threadName: undefined,
    compactionPoints: undefined,
  }
  if (session.threads && session.threads.length > 0) {
    const lastThread = session.threads[session.threads.length - 1]
    updatedSession.messages = lastThread.messages
    updatedSession.threads = session.threads.slice(0, session.threads.length - 1)
    updatedSession.threadName = lastThread.name
    updatedSession.compactionPoints = lastThread.compactionPoints
  }
  await chatStore.updateSession(session.id, updatedSession)
}

/**
 * Compress current session and create new thread, preserving compressed context
 * @param sessionId Session ID
 * @param summary Compressed summary content
 */
export async function compressAndCreateThread(sessionId: string, summary: string) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }

  // Cancel all ongoing message generations
  for (const m of session.messages) {
    m?.cancel?.()
  }

  // Create new thread with all messages
  const newThread: SessionThread = {
    id: uuidv4(),
    name: session.threadName || session.name,
    messages: session.messages,
    createdAt: Date.now(),
    compactionPoints: session.compactionPoints,
  }

  // Get original system prompt (if exists)
  const systemPrompt = session.messages.find((m) => m.role === 'system')
  let systemPromptText = ''
  if (systemPrompt) {
    systemPromptText = getMessageText(systemPrompt)
  }

  // Create new message list with original system prompt and compressed context
  const newMessages: Message[] = []

  // Add system prompt first if exists
  if (systemPromptText) {
    newMessages.push(createMessage('system', systemPromptText))
  }

  // Add compressed context as user message
  const compressionContext = `Previous conversation summary:\n\n${summary}`
  newMessages.push(createMessage('user', compressionContext))

  // Save session
  await chatStore.updateSessionWithMessages(session.id, {
    ...session,
    threads: session.threads ? [...session.threads, newThread] : [newThread],
    messages: newMessages,
    threadName: '',
    messageForksHash: undefined,
    compactionPoints: undefined,
  })

  // Auto-scroll to bottom and focus input
  setTimeout(() => {
    scrollActions.scrollToBottom()
    dom.focusMessageInput()
  }, 100)
}

export async function moveThreadToConversations(sessionId: string, threadId: string) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  if (session.id === threadId) {
    await moveCurrentThreadToConversations(sessionId)
    return
  }
  const targetThread = session.threads?.find((t) => t.id === threadId)
  if (!targetThread) {
    return
  }
  const newSession = await copySession({
    ...session,
    name: targetThread.name,
    messages: targetThread.messages,
    threads: [],
    threadName: undefined,
    compactionPoints: targetThread.compactionPoints,
  })
  await removeThread(sessionId, threadId)
  switchCurrentSession(newSession.id)
}

export async function moveCurrentThreadToConversations(sessionId: string) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  const newSession = await copySession({
    ...session,
    name: session.threadName || session.name,
    messages: session.messages,
    threads: [],
    threadName: undefined,
    compactionPoints: session.compactionPoints,
  })
  await removeCurrentThread(sessionId)
  switchCurrentSession(newSession.id)
}
