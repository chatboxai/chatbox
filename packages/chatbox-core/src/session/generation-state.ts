import type { Message, Session } from '../types'

type GenerationStateMessage = Pick<Message, 'id' | 'role' | 'generating'>
const EMPTY_ACTIVE_GENERATION_MESSAGE_IDS: ReadonlySet<string> = new Set()

export function isCancellableGeneratingAssistantMessage(
  message: GenerationStateMessage,
  generationRuntimeActive: boolean
): boolean {
  return message.role === 'assistant' && message.generating === true && generationRuntimeActive
}

export function countCancellableGeneratingAssistantMessages(
  messages: GenerationStateMessage[],
  activeGenerationMessageIds: ReadonlySet<string>
): number {
  return messages.reduce(
    (count, message) =>
      count + Number(isCancellableGeneratingAssistantMessage(message, activeGenerationMessageIds.has(message.id))),
    0
  )
}

interface ReachableMessageTraversal {
  messages: Message[]
  seenMessageIds: Set<string>
  visitedForkIds: Set<string>
}

function createReachableMessageTraversal(): ReachableMessageTraversal {
  return {
    messages: [],
    seenMessageIds: new Set(),
    visitedForkIds: new Set(),
  }
}

function collectReachableMessages(
  session: Session,
  initialLists: Message[][],
  traversal: ReachableMessageTraversal = createReachableMessageTraversal()
): ReachableMessageTraversal {
  const pendingLists = [...initialLists]

  for (let listIndex = 0; listIndex < pendingLists.length; listIndex += 1) {
    const list = pendingLists[listIndex]
    if (!list) continue

    for (const message of list) {
      if (!traversal.seenMessageIds.has(message.id)) {
        traversal.seenMessageIds.add(message.id)
        traversal.messages.push(message)
      }

      const fork = session.messageForksHash?.[message.id]
      if (!fork || traversal.visitedForkIds.has(message.id)) {
        continue
      }
      traversal.visitedForkIds.add(message.id)
      for (const branch of fork.lists) {
        pendingLists.push(branch.messages)
      }
    }
  }

  return traversal
}

/** Return every message reachable from the active conversation or a historical thread. */
export function getReachableSessionMessages(session: Session): Message[] {
  return collectReachableMessages(session, [
    session.messages,
    ...(session.threads ?? []).map((thread) => thread.messages),
  ]).messages
}

/**
 * Return messages reachable from the current conversation, including saved
 * fork branches but excluding historical threads.
 */
export function getConversationMessages(session: Session, messages: Message[]): Message[] {
  return collectReachableMessages(session, [messages]).messages
}

export function getCurrentConversationMessages(session: Session): Message[] {
  return getConversationMessages(session, session.messages)
}

type GenerationControlBase = {
  currentMessageIds: ReadonlySet<string>
  visibleMessages: Message[]
}

// Several consumers derive lock state from the same Session snapshot in one
// render pass. Cache the runtime-independent traversal per Session identity;
// runtime ids are still filtered fresh whenever the store changes.
const generationControlBaseCache = new WeakMap<Session, GenerationControlBase>()

function getGenerationControlBase(session: Session): GenerationControlBase {
  const cached = generationControlBaseCache.get(session)
  if (cached) return cached

  const traversal = collectReachableMessages(session, [session.messages])
  const currentMessageIds = new Set(traversal.messages.map((message) => message.id))
  collectReachableMessages(
    session,
    (session.threads ?? []).map((thread) => thread.messages),
    traversal
  )
  const result = {
    currentMessageIds,
    visibleMessages: traversal.messages,
  }
  generationControlBaseCache.set(session, result)
  return result
}

/**
 * Return messages that should control the session-level generating UI.
 *
 * Current conversation messages keep their existing behavior, including the
 * short placeholder window before an AbortController is registered. Historical
 * threads and their forks are included only while their message id has an active
 * runtime, so stale persisted `generating: true` flags cannot lock the session.
 */
export function getGenerationControlMessages(
  session: Session,
  activeGenerationMessageIds: ReadonlySet<string> = EMPTY_ACTIVE_GENERATION_MESSAGE_IDS
): Message[] {
  const { currentMessageIds, visibleMessages } = getGenerationControlBase(session)

  return visibleMessages.filter(
    (message) =>
      currentMessageIds.has(message.id) ||
      isCancellableGeneratingAssistantMessage(message, activeGenerationMessageIds.has(message.id))
  )
}
