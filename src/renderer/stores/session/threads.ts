import * as defaults from '@shared/defaults'
import { createMessage, type Message, type Session, type SessionThread } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { v4 as uuidv4 } from 'uuid'
import * as dom from '@/hooks/dom'
import * as chatStore from '../chatStore'
import * as scrollActions from '../scrollActions'
import { _copySession as copySession, switchCurrentSession } from './crud'
import { getCurrentConversationMessages } from './generation-state'

function cancelCurrentConversationGenerations(session: Session): void {
  for (const message of getCurrentConversationMessages(session)) {
    message.cancel?.()
  }
}

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

  await chatStore.updateSessionWithMessages(sessionId, { threads })
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
  return await chatStore.updateSessionWithMessages(sessionId, {
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
  cancelCurrentConversationGenerations(session)
  // Build the transfer from the queue's current session (not the snapshot
  // above): a compaction commit may still be persisting, and submitting a
  // stale full object would overwrite its summary and compaction point.
  await chatStore.updateSessionWithMessages(sessionId, (current) => {
    if (!current?.threads) {
      throw new Error(`Session ${sessionId} not found during thread switch`)
    }
    const currentTarget = current.threads.find((h) => h.id === threadId)
    if (!currentTarget) {
      return current
    }
    // Compaction points travel with their message list: the archived thread
    // keeps the active conversation's points, the restored conversation takes
    // the thread's own points (see buildCompactionCommitPatch).
    const newThreads = current.threads.filter((h) => h.id !== threadId)
    newThreads.push({
      id: uuidv4(),
      name: current.threadName || current.name,
      messages: current.messages,
      createdAt: Date.now(),
      compactionPoints: current.compactionPoints,
    })
    return {
      ...current,
      threads: newThreads,
      messages: currentTarget.messages,
      threadName: currentTarget.name,
      compactionPoints: currentTarget.compactionPoints,
    }
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
  cancelCurrentConversationGenerations(session)
  // Archive from the queue's current session, not the snapshot above: a
  // compaction commit may still be persisting its summary/point.
  await chatStore.updateSessionWithMessages(sessionId, (current) => {
    if (!current) {
      throw new Error(`Session ${sessionId} not found during thread creation`)
    }
    const newThread: SessionThread = {
      id: uuidv4(),
      name: current.threadName || current.name,
      messages: current.messages,
      createdAt: Date.now(),
      // The archived conversation keeps its compaction points with it.
      compactionPoints: current.compactionPoints,
    }

    let systemPrompt = current.messages.find((m) => m.role === 'system')
    if (systemPrompt) {
      systemPrompt = createMessage('system', getMessageText(systemPrompt))
    }
    return {
      ...current,
      threads: current.threads ? [...current.threads, newThread] : [newThread],
      messages: systemPrompt ? [systemPrompt] : [createMessage('system', defaults.getDefaultPrompt())],
      threadName: '',
      compactionPoints: undefined,
    }
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
  cancelCurrentConversationGenerations(session)
  await chatStore.updateSessionWithMessages(sessionId, (current) => {
    if (!current) {
      throw new Error(`Session ${sessionId} not found during thread removal`)
    }
    const updatedSession: Session = {
      ...current,
      messages: current.messages.filter((m) => m.role === 'system').slice(0, 1), // Keep only one system prompt
      threadName: undefined,
      // The discarded conversation takes its compaction points with it.
      compactionPoints: undefined,
    }
    if (current.threads && current.threads.length > 0) {
      const lastThread = current.threads[current.threads.length - 1]
      updatedSession.messages = lastThread.messages
      updatedSession.threads = current.threads.slice(0, current.threads.length - 1)
      updatedSession.threadName = lastThread.name
      updatedSession.compactionPoints = lastThread.compactionPoints
    }
    return updatedSession
  })
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

  cancelCurrentConversationGenerations(session)

  // Archive from the queue's current session, not the snapshot above.
  await chatStore.updateSessionWithMessages(sessionId, (current) => {
    if (!current) {
      throw new Error(`Session ${sessionId} not found during compression`)
    }
    // Create new thread with all messages
    const newThread: SessionThread = {
      id: uuidv4(),
      name: current.threadName || current.name,
      messages: current.messages,
      createdAt: Date.now(),
      // The archived conversation keeps its compaction points with it.
      compactionPoints: current.compactionPoints,
    }

    // Get original system prompt (if exists)
    const systemPrompt = current.messages.find((m) => m.role === 'system')
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

    return {
      ...current,
      threads: current.threads ? [...current.threads, newThread] : [newThread],
      messages: newMessages,
      threadName: '',
      messageForksHash: undefined,
      compactionPoints: undefined,
    }
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
    messageForksHash: session.messageForksHash,
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
    messageForksHash: session.messageForksHash,
  })
  await removeCurrentThread(sessionId)
  switchCurrentSession(newSession.id)
}
